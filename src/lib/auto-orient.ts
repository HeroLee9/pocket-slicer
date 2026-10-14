import type {Model} from './model';
import type {AutoOrientOptions,AutoOrientResult,ObjectTransform} from './geometry';
export function autoOrientAsync(model:Model,transform:ObjectTransform,options:AutoOrientOptions & {signal?:AbortSignal}={}):Promise<AutoOrientResult>{
  return new Promise((resolve,reject)=>{
    if(options.signal?.aborted){reject(new DOMException('Auto orient cancelled.','AbortError'));return;}
    const worker=new Worker(new URL('./auto-orient.worker.ts',import.meta.url),{type:'module'});
    const abort=()=>finish(new DOMException('Auto orient cancelled.','AbortError'));
    const timeout=window.setTimeout(()=>finish(new Error('Auto orient took too long. Simplify the model or rotate it manually.')),120_000);
    let done=false;
    const finish=(error?:Error,result?:AutoOrientResult)=>{if(done)return;done=true;clearTimeout(timeout);options.signal?.removeEventListener('abort',abort);worker.terminate();if(error)reject(error);else resolve(result!);};
    options.signal?.addEventListener('abort',abort,{once:true});
    worker.onmessage=({data})=>{if(data.type==='progress')options.onProgress?.(data.completed,data.total);else if(data.type==='result')finish(undefined,data.result);else if(data.type==='error')finish(new Error(data.error));};
    worker.onerror=()=>finish(new Error('Auto orient could not start. Rotate the model manually or try again.'));
    try{
      const p=model.geometry.getAttribute('position'),index=model.geometry.index;
      const positions=new Float32Array((index?.count??p.count)*3);
      for(let i=0;i<positions.length/3;i++){const n=index?index.getX(i):i;positions[i*3]=p.getX(n);positions[i*3+1]=p.getY(n);positions[i*3+2]=p.getZ(n);}
      worker.postMessage({positions,transform,options:{brim:options.brim,bedSize:options.bedSize}},[positions.buffer]);
    }catch(error){finish(error instanceof Error?error:new Error(String(error)));}
  });
}
