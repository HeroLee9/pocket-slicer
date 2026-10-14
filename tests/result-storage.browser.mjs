// Real IndexedDB/worker/reload tests. Run: node tests/result-storage.browser.mjs
// Playwright browsers must already be installed; TEST_BROWSERS can select one.
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {chromium,webkit} from '@playwright/test';
const helper=await readFile(new URL('../public/engine/result-storage.js',import.meta.url));
const worker=`importScripts('/engine/result-storage.js'); self.onmessage=async({data})=>{const result={gcode:new Uint8Array(data),name:'worker-slice.gcode',statistics:{timeSeconds:{normal:42}},elapsedMs:1234,layerCount:100}; const recovery=await PocketSliceStorage.save(result,new URL('/pocket/',self.location)); self.postMessage({recovery,bytes:result.gcode.buffer},[result.gcode.buffer]);};`;
const html='<!doctype html><title>Slice recovery test</title><button id="save">Save recovered G-code</button><script src="/engine/result-storage.js"></script>';
const server=createServer((req,res)=>{const path=new URL(req.url,'http://localhost').pathname; const body=path.endsWith('/result-storage.js')?helper:path==='/worker.js'?worker:html;res.writeHead(200,{'Content-Type':path.endsWith('.js')?'text/javascript':'text/html'});res.end(body);});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const origin=`http://localhost:${server.address().port}`;
const browsers=(process.env.TEST_BROWSERS||'chromium,webkit').split(',');
const report=[];
try{
for(const kind of browsers){
 const browser=kind==='webkit'?await webkit.launch({headless:true}):await chromium.launch({headless:true,...(process.env.CHROMIUM_EXECUTABLE_PATH?{executablePath:process.env.CHROMIUM_EXECUTABLE_PATH}:{}),args:process.platform==='linux'?['--no-sandbox']:[]});
 try{
  const page=await browser.newPage({acceptDownloads:true});const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(origin+'/pocket/');
  const written=await page.evaluate(async()=>{
   const bytes=new Uint8Array(2*1024*1024);for(let i=0;i<bytes.length;i++)bytes[i]=32+i%90;
   const digest=async b=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',b))).map(x=>x.toString(16).padStart(2,'0')).join('');
   const expected=await digest(bytes);
   const response=await new Promise((resolve,reject)=>{const w=new Worker('/worker.js');w.onmessage=e=>{w.terminate();resolve(e.data);};w.onerror=reject;w.postMessage(bytes.buffer,[bytes.buffer]);});
   const saved=await PocketSliceStorage.load(new URL('/pocket/',location));
   return {expected,recovery:response.recovery,deliveredBytes:response.bytes.byteLength,savedId:saved?.id,savedHash:saved?await digest(await saved.gcode.arrayBuffer()):null,savedBytes:saved?.byteLength};
  });
  assert.equal(written.recovery.saved,true);assert.equal(written.savedId,written.recovery.id);assert.equal(written.expected,written.savedHash);assert.equal(written.deliveredBytes,2*1024*1024);
  await page.reload();
  const reloaded=await page.evaluate(async()=>{
   const base=new URL('/pocket/',location),api=PocketSliceStorage;
   const saved=await api.load(base);globalThis.recovered=saved;
   document.querySelector('#save').onclick=()=>{const a=document.createElement('a');a.href=URL.createObjectURL(saved.gcode);a.download=saved.name;a.click();};
   return {id:saved.id,size:saved.gcode.size,name:saved.name,savedAt:saved.savedAt,separate:await api.load(new URL('/other/',location))};
  });
  assert.equal(reloaded.id,written.savedId);assert.equal(reloaded.size,written.savedBytes);assert.equal(reloaded.separate,null);assert.equal(typeof reloaded.savedAt,'number');
  const downloadPromise=page.waitForEvent('download');await page.locator('#save').click();const download=await downloadPromise;
  const downloaded=await readFile(await download.path());assert.equal(downloaded.byteLength,reloaded.size);assert.equal(createHash('sha256').update(downloaded).digest('hex'),written.expected);assert.equal(download.suggestedFilename(),'worker-slice.gcode');
  const failureTests=await page.evaluate(async()=>{
   const api=PocketSliceStorage,base=new URL('/pocket/',location),previous=await api.load(base);
   const result={gcode:new TextEncoder().encode('G1 X100 Y100 Z.2 E.3\n'),name:'replacement.gcode',statistics:null,elapsedMs:2,layerCount:1};
   const put=IDBObjectStore.prototype.put;
   let aborted,quota;
   try{IDBObjectStore.prototype.put=function(...args){const request=put.apply(this,args);this.transaction.abort();return request;};aborted=await api.save(result,base);}finally{IDBObjectStore.prototype.put=put;}
   const afterAbort=await api.load(base);
   try{IDBObjectStore.prototype.put=function(){throw new DOMException('test quota','QuotaExceededError');};quota=await api.save(result,base);}finally{IDBObjectStore.prototype.put=put;}
   const afterQuota=await api.load(base);
   const replacement=await api.save(result,base);await api.remove(previous.id,base);const retained=await api.load(base);
   await api.remove(replacement.id,base);const deleted=await api.load(base);
   const descriptor=Object.getOwnPropertyDescriptor(globalThis,'indexedDB');let unavailable;
   try{Object.defineProperty(globalThis,'indexedDB',{configurable:true,value:undefined});unavailable=await api.save(result,base);}finally{if(descriptor)Object.defineProperty(globalThis,'indexedDB',descriptor);else delete globalThis.indexedDB;}
   return {previous:previous.id,aborted,quota,afterAbort:afterAbort.id,afterQuota:afterQuota.id,replacement,retained:retained.id,deleted,unavailable,currentBytes:result.gcode.byteLength};
  });
  assert.equal(failureTests.aborted.saved,false);assert.equal(failureTests.afterAbort,failureTests.previous);
  assert.equal(failureTests.quota.saved,false);assert.match(failureTests.quota.reason,/Not enough/);assert.equal(failureTests.afterQuota,failureTests.previous);
  assert.equal(failureTests.retained,failureTests.replacement.id);assert.equal(failureTests.deleted,null);assert.equal(failureTests.unavailable.saved,false);assert(failureTests.currentBytes>0);assert.deepEqual(errors,[]);
  report.push({browser:kind,workerCommitBeforeResult:true,reloadRecoveredBytes:reloaded.size,downloadBytes:downloaded.byteLength,pathIsolation:true,abortKeepsPrevious:true,quotaKeepsPrevious:true,oldCardCannotDeleteNewer:true,delete:true,unavailableStillReturnsCurrentBytes:true,pageErrors:errors});
  console.log('PASS',kind,JSON.stringify(report.at(-1)));
 }finally{await browser.close();}
}
}finally{server.close();}
console.log(JSON.stringify(report,null,2));
