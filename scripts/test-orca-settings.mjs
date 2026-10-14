// Test our complete option catalog and changed settings against the shipped WASM.
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createRequire} from 'node:module';
import {buildConfig} from '../src/profiles/index.ts';
import {ORCA_OPTIONS,applyOverrides,optionValue,validateOption} from '../src/lib/orca-settings.ts';

const directory=await mkdtemp(join(tmpdir(),'pocket-orca-options-'));
let engine,session;
try{
  const location=new URL('../public/engine/',import.meta.url);
  const source=await readFile(new URL('slicer-mt.js',location),'utf8');
  const wasmBinary=Buffer.concat(await Promise.all([0,1].map(part=>readFile(new URL(`slicer-mt.wasm.part${part}`,location)))));
  const worker=join(directory,'slicer-mt.cjs');await writeFile(worker,source);
  globalThis.require??=createRequire(import.meta.url);globalThis.__dirname??=directory;globalThis.__filename??=worker;
  const artifact=(await import(`data:text/javascript;charset=utf-8,${encodeURIComponent(source+'\nexport default OneSlicerEngine;')}`)).default;
  engine=await artifact.createEngine({runtime:{wasmBinary,mainScriptUrlOrBlob:worker}});session=await engine.createSession();
  const encode=value=>new TextEncoder().encode(JSON.stringify(value));
  const base=buildConfig();
  await session.init(encode(base));
  await session.applyProfile('orca.native-json',encode(base));
  await assert.rejects(()=>session.applyProfile('orca.native-json',encode({outer_wall_speed:'not-a-number'})));
  const accepted=[],missing=[],rejected=[];
  for(const option of ORCA_OPTIONS.filter(option=>!option.unavailable)){
    const value=optionValue(option,base);
    if(value===undefined){missing.push(option.key);continue;}
    const error=validateOption(option,value);
    if(error){rejected.push({key:option.key,value,error});continue;}
    try{await session.applyProfile('orca.native-json',encode({[option.key]:value}));accepted.push(option.key);}
    catch(cause){rejected.push({key:option.key,value,error:String(cause)});}
  }
  console.log(JSON.stringify({catalog:ORCA_OPTIONS.length,editable:ORCA_OPTIONS.filter(o=>!o.unavailable).length,accepted:accepted.length,missing,rejected},null,2));
  assert.equal(rejected.length,0,'Catalog values must be accepted by the actual engine');
  const vertices=[[-10,-10,0],[10,-10,0],[10,10,0],[-10,10,0],[-10,-10,10],[10,-10,10],[10,10,10],[-10,10,10]];
  const faces=[[0,2,1],[0,3,2],[4,5,6],[4,6,7],[0,1,5],[0,5,4],[1,2,6],[1,6,5],[2,3,7],[2,7,6],[3,0,4],[3,4,7]];
  const mesh=new Uint8Array(84+faces.length*50),view=new DataView(mesh.buffer);view.setUint32(80,faces.length,true);
  faces.forEach((triangle,i)=>triangle.forEach((v,j)=>vertices[v].forEach((coordinate,axis)=>view.setFloat32(84+i*50+12+j*12+axis*4,coordinate,true))));
  const manifest={schemaVersion:'0.7.0',plates:[{id:'p',index:0}],meshes:[{id:'m',format:'stl',dataRange:{offset:0,length:mesh.length}}],objects:[{id:'o',meshId:'m'}],instances:[{id:'i',objectId:'o',plateId:'p',transform:{matrix:[1,0,0,110,0,1,0,110,0,0,1,0,0,0,0,1]}}],modifierVolumes:[]};
  const scenarios=[
    {name:'layer height / walls / seams / cooling / retraction',overrides:{layer_height:'0.25',wall_loops:'3',seam_position:'random',fan_max_speed:['70'],retraction_length:['1.1'],sparse_infill_pattern:'gyroid',sparse_infill_density:'20%',outer_wall_speed:'45',wall_sequence:'inner-outer-inner wall',default_acceleration:'5000'}},
    {name:'custom G-code and deliberately empty G-code',overrides:{before_layer_change_gcode:'; test custom layer hook\nG92 E0',filament_start_gcode:[''],machine_end_gcode:'END_PRINT\n; POCKET_SETTINGS_TEST'}},
    {name:'ironing / fuzzy skin / percentages',overrides:{ironing_type:'top',ironing_flow:'15%',fuzzy_skin:'external',fuzzy_skin_thickness:'0.1',fuzzy_skin_point_distance:'0.4',wall_transition_length:'80%'}},
  ];
  for(const scenario of scenarios){
    const config=applyOverrides(base,scenario.overrides);await session.init(encode(config));await session.applyProfile('orca.native-json',encode(config));await session.setObjects(mesh,manifest);
    const result=await session.slice({schemaVersion:'0.7.0',plateSelection:'all',includeGcode:true,includeStatistics:true});
    const plate=result.plateResults[0],asset=plate.assets.find(asset=>asset.kind==='gcode');assert(asset);
    const gcode=new TextDecoder().decode(await session.getAsset(asset.id));assert(gcode.includes('START_PRINT'));
    for(const [key,value]of Object.entries(scenario.overrides)){
      if(key==='filament_start_gcode'){const actual=gcode.match(/^; filament_start_gcode = (.*)$/m)?.[1];assert(['','""'].includes(actual),`Empty filament start G-code was not preserved: ${JSON.stringify(actual)}`);continue;}
      if(key==='machine_end_gcode'){assert(gcode.includes('; POCKET_SETTINGS_TEST'));continue;}
      if(key==='before_layer_change_gcode'){assert(gcode.includes('; test custom layer hook'));continue;}
      const actual=gcode.match(new RegExp('^; '+key+' = (.*)$','m'))?.[1];assert.equal(actual,Array.isArray(value)?value.join(','):value,`${scenario.name}: ${key}`);
    }
    assert(plate.statistics.filament.totalLengthMm>0);
    console.log(`PASS ${scenario.name}: ${gcode.length} bytes`);
  }
}finally{await session?.dispose();await engine?.dispose();await rm(directory,{recursive:true,force:true});}
