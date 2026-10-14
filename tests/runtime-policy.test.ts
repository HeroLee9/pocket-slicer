import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {describe,it,expect} from 'vitest';

function policy() {
  const allocations: WebAssembly.MemoryDescriptor[] = [];
  const context = {WebAssembly:{Memory:class {constructor(options:WebAssembly.MemoryDescriptor){allocations.push(options);}}},performance:{now:()=>0}};
  runInNewContext(readFileSync(new URL('../public/engine/pocket-runtime-policy.js',import.meta.url),'utf8'),context);
  return {api:(context as any).PocketRuntimePolicy,allocations};
}

describe('mobile slicing runtime policy',()=>{
  it('uses shared 256 MiB initial memory with an explicit bounded maximum',()=>{
    const {api,allocations}=policy();api.createMemory(768);
    expect(allocations).toEqual([{initial:4096,maximum:12288,shared:true}]);
    expect(()=>api.createMemory(255)).toThrow(/between 256 and 1024/);
    expect(()=>api.createMemory(1025)).toThrow(/between 256 and 1024/);
    expect(()=>api.createMemory(NaN)).toThrow();
  });
  it('explains native allocation failures without mislabeling native access errors or cancellation',()=>{
    const {api}=policy();
    for(const message of ['std::bad_alloc','out of engine memory polling an operation','WebAssembly.Memory(): could not allocate memory','Maximum memory size exceeded']){
      expect(api.describeError(new Error(message))).toMatchObject({code:'MEMORY_LIMIT',message:expect.stringContaining('reached its memory limit')});
    }
    expect(api.describeError(new Error('memory access out of bounds'))).toEqual({code:'ENGINE',message:'memory access out of bounds'});
    expect(api.describeError({code:'CANCELLED',message:'Slicing cancelled.'})).toEqual({code:'CANCELLED',message:'Slicing cancelled.'});
    expect(api.describeError({code:'VALIDATION',message:'Model exceeds the bed.'})).toEqual({code:'VALIDATION',message:'Model exceeds the bed.'});
  });
  it('limits layer bursts to ten updates per second while preserving phase transitions',()=>{
    const {api}=policy();let time=0;const updates:{stage:string;percent:number|null}[]=[];
    const progress=api.createProgressReporter((value:any)=>updates.push(value),()=>time);
    progress('Slicing mesh',5);progress('Generating G-code: layer 1',80);
    for(let layer=2;layer<1000;layer++){time=layer;progress(`Generating G-code: layer ${layer}`,80);}
    expect(updates.filter(p=>p.stage.startsWith('Generating G-code'))).toHaveLength(10);
    progress('Checking print boundaries',99);progress('Keeping completed G-code on this device',99);progress('G-code ready',100);
    expect(updates.slice(-3).map(p=>p.stage)).toEqual(['Checking print boundaries','Keeping completed G-code on this device','G-code ready']);
  });
  it('delivers completion immediately, skips duplicates, and limits download chunks',()=>{
    const {api}=policy();const updates:{stage:string;percent:number|null}[]=[];
    const progress=api.createProgressReporter((value:any)=>updates.push(value),()=>0);
    for(let percent=0;percent<=99;percent++)progress('Loading local slicing engine',percent);
    expect(updates).toHaveLength(1);
    progress('Loading local slicing engine',100);progress('Loading local slicing engine',100);
    expect(updates).toHaveLength(2);expect(updates.at(-1)?.percent).toBe(100);
    progress('Preparing model',NaN);expect(updates.at(-1)?.percent).toBeNull();
  });
});
