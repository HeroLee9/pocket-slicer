import {afterEach,describe,expect,it,vi} from 'vitest';
import type {GcodePreview} from '../src/lib/gcode';

afterEach(()=>{vi.unstubAllGlobals();vi.resetModules();});
async function worker(){
  const scope={onmessage:undefined as undefined|((event:{data:Uint8Array|Blob})=>Promise<void>),postMessage:vi.fn()};
  vi.stubGlobal('self',scope);await import('../src/lib/gcode.worker');return scope;
}
const source='M83\nG1 X0 Y0 Z.2\nG1 X10 E1';
describe('preview worker input and failure handling',()=>{
 it.each(['bytes','blob'] as const)('accepts %s and transfers only finished geometry',async format=>{
  const scope=await worker();const data=format==='blob'?new Blob([source]):new TextEncoder().encode(source);
  await scope.onmessage!({data});expect(scope.postMessage).toHaveBeenCalledTimes(1);
  const [message,options]=scope.postMessage.mock.calls[0] as [{preview:GcodePreview},{transfer:ArrayBuffer[]}];
  expect(message.preview.segments).toBe(1);expect(message.preview.positions[3]).toBe(10);
  expect(options.transfer).toEqual([message.preview.positions.buffer,message.preview.colors.buffer]);
 });
 it('reports a Blob read failure without an uncaught worker rejection',async()=>{
  const scope=await worker(),blob=new Blob([source]);vi.spyOn(blob,'arrayBuffer').mockRejectedValue(new Error('Could not read saved G-code.'));
  await expect(scope.onmessage!({data:blob})).resolves.toBeUndefined();
  expect(scope.postMessage).toHaveBeenCalledWith({error:'Could not read saved G-code.'});
 });
});
