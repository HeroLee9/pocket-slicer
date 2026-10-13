import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { describe, expect, test } from 'vitest';
const source=readFileSync(new URL('../public/engine/gcode-validation.js',import.meta.url),'utf8');
const validate=runInNewContext(source+'\nvalidateGcodeEnvelope;') as (gcode:string,limits?:{x:number;y:number;z:number})=>{moveCount:number;depositionMoves:number};
const start='START_PRINT EXTRUDER_TEMP=220 BED_TEMP=55\nG90\nM83\nG1 X100 Y100 Z.2\n';
const print='G1 X110 Y100 E.3\n';

describe('post-slice build volume verification',()=>{
 test('accepts real Orca fractional numbers and ignores comments and firmware macros',()=>{
  const result=validate(start+print+'G1 E-.8\nG92 E0\n; G1 X999\nEND_PRINT');
  expect(result.depositionMoves).toBe(1);
 });
 test.each(['G1 X220.01 E.1','G1 Y-.01 E.1','G1 Z250.01 E.1','G1 X221'])('rejects brim/support/travel outside the build volume: %s',line=>{
  expect(()=>validate(start+print+line)).toThrow(/exceeds.*build volume/);
 });
 test('relative moves accumulate machine coordinates',()=>{
  expect(()=>validate(start+print+'G91\nG1 X111 E.1')).toThrow(/X=221/);
  expect(validate(start+print+'G91\nG1 X1 Y-1 E.1').depositionMoves).toBe(2);
 });
 test('G92 E only resets the extruder counter; it is not a motion',()=>{
  expect(validate(start+'M82\nG92 E999999\nG1 X110 E1000000').depositionMoves).toBe(1);
 });
 test('G92 XYZ coordinate reset cannot conceal an out of range physical motion',()=>{
  expect(()=>validate(start+'G1 X210\nG92 X0\nG1 X20 E.1')).toThrow(/X=230/);
 });
 test('inch coordinates are converted before checking the millimeter build volume',()=>{
  expect(validate('G20\nG90\nM83\nG1 X4 Y4 Z.01\nG1 X5 E.01').depositionMoves).toBe(1);
  expect(()=>validate('G20\nG90\nM83\nG1 X4 Y4 Z.01\nG1 X9 E.01')).toThrow(/X=228.600/);
 });
 test('checks swept arc extrema even when both endpoints are inside the bed',()=>{
  const arcStart='G90\nM83\nG1 X219 Y108 Z.2\n';
  expect(()=>validate(arcStart+'G3 X219 Y112 I0 J2 E.1')).toThrow(/X=221/);
  expect(validate(arcStart+'G2 X219 Y112 I0 J2 E.1').depositionMoves).toBe(1);
 });
 test('checks full circles and radius-form arcs',()=>{
  expect(()=>validate('G90\nM83\nG1 X217 Y110 Z.2\nG2 I2 J0 E.1')).toThrow(/X=221/);
  expect(()=>validate('G90\nM83\nG1 X219 Y108 Z.2\nG3 X219 Y112 R2 E.1')).toThrow(/X=221/);
 });
 test('rejects extrusion-free files and unknown initial relative position',()=>{
  expect(()=>validate(start+'G1 E.8')).toThrow(/no deposition/);
  expect(()=>validate('G91\nM83\nG1 X5 E.1')).toThrow(/first absolute position/);
 });
});
