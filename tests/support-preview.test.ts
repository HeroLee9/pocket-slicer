import {describe,it,expect} from 'vitest';
import {parseSupportPreview,MAX_SUPPORT_PREVIEW_SEGMENTS} from '../src/lib/gcode';

describe('whole-model support overview',()=>{
 it('retains supports and interfaces, excludes model walls/infill/brim, and keeps intervening coordinates',()=>{
  const input='M83\nG1 X10 Y20 Z.2\n;TYPE:Outer wall\nG1 X15 E.2\n;TYPE:Support\n;WIDTH:0.48\n;HEIGHT:0.2\nG1 X20 E.2\n;TYPE:Sparse infill\nG1 Y30 E.2\n;TYPE:Support interface\n;WIDTH:0.4\n;HEIGHT:0.1\nG1 X25 E.2\n;TYPE:Brim\nG1 X30 E.2';
  const preview=parseSupportPreview(new TextEncoder().encode(input));
  expect(preview.segments).toBe(2);expect(preview.totalSegments).toBe(2);expect(preview.truncated).toBe(false);
  expect(Array.from(preview.positions)).toEqual([15,20,expect.closeTo(.2),20,20,expect.closeTo(.2),20,30,expect.closeTo(.2),25,30,expect.closeTo(.2)]);
  expect(Array.from(preview.widths)).toEqual([expect.closeTo(.48),expect.closeTo(.4)]);
  expect(Array.from(preview.heights)).toEqual([expect.closeTo(.2),expect.closeTo(.1)]);
  expect(preview.colors[1]).toBeGreaterThan(preview.colors[0]);
 });
 it('supports legacy feature names and absolute extrusion with retractions/resets',()=>{
  const p=parseSupportPreview('M82\nG1 X10 Y10 Z.2\nG92 E0\n;FEATURE:Support material\nG1 X20 E1\nG1 X22 E.5\nG92 E0\n;FEATURE:Support material interface\nG1 Y20 E1\n;FEATURE:Top surface\nG1 X40 E2');
  expect(p.segments).toBe(2);expect(p.positions[0]).toBe(10);expect(p.positions[6]).toBe(22);
  expect(Array.from(p.widths)).toEqual([expect.closeTo(.45),expect.closeTo(.45)]);
 });
 it('returns no geometry for an unsupported print or a role merely containing the word support',()=>{
  const p=parseSupportPreview('M83\nG1 X0 Y0 Z.2\nG1 X10 E1\n;TYPE:Support-looking model\nG1 X20 E1');
  expect(p.segments).toBe(0);expect(p.totalSegments).toBe(0);expect(p.positions.byteLength+p.colors.byteLength+p.widths.byteLength+p.heights.byteLength).toBe(0);
 });
 it('expands only support arcs into bounded support segments with extrusion dimensions',()=>{
  const p=parseSupportPreview('M83\nG1 X100 Y100 Z.4\n;TYPE:Outer wall\nG2 X120 Y100 I10 J0 E1\n;TYPE:Support\n;WIDTH:0.6\n;HEIGHT:0.3\nG2 X100 Y100 I-10 J0 E1');
  expect(p.segments).toBeGreaterThan(4);expect(p.positions[0]).toBe(120);expect(p.positions.at(-3)).toBe(100);
  expect(p.widths.every(value=>Math.abs(value-.6)<1e-6)).toBe(true);expect(p.heights.every(value=>Math.abs(value-.3)<1e-6)).toBe(true);
 });
 it('samples supports across the full height with a fixed allocation and no model-path budget use',()=>{
  const input='M83\nG1 X0 Y0 Z.2\n;TYPE:Outer wall\n'+('G1 X1 E.1\nG1 X0 E.1\n').repeat(50)+';TYPE:Support\n'+('G1 X1 E.1\nG1 X0 E.1\n').repeat(MAX_SUPPORT_PREVIEW_SEGMENTS/2+20)+'G1 X2 Z40 E.1\n';
  const p=parseSupportPreview(new TextEncoder().encode(input));
  expect(p.segments).toBe(MAX_SUPPORT_PREVIEW_SEGMENTS);expect(p.totalSegments).toBe(MAX_SUPPORT_PREVIEW_SEGMENTS+41);expect(p.truncated).toBe(true);
  expect(p.positions[0]).toBe(0);expect(p.positions.at(-3)).toBe(2);expect(p.positions.at(-1)).toBe(40);
  expect(p.positions.byteLength+p.colors.byteLength+p.widths.byteLength+p.heights.byteLength).toBe(MAX_SUPPORT_PREVIEW_SEGMENTS*14*4);
 });
});
