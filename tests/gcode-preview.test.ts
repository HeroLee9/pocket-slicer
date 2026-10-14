import {describe,it,expect,vi} from 'vitest';
import {parseGcode,MAX_PREVIEW_SEGMENTS,MAX_PREVIEW_LAYERS,MAX_PREVIEW_LINE_LENGTH} from '../src/lib/gcode';

describe('real G-code preview semantics',()=>{
 it('honors relative extrusion, leading-dot numbers, retractions and layer height',()=>{
  const p=parseGcode('M83\nG1 X100 Y100 Z.2\nG1 X110 E.4\nG1 E-.8\nG1 X120\nG1 E.8\nG1 Y110 E.5\nG1 Z.4\nG1 X100 E.5\n; total filament used [g] = 2.75\n; estimated printing time (normal mode) = 3m 2s');
  expect(p.segments).toBe(3);expect(p.layers).toEqual([{z:.2,end:4},{z:.4,end:6}]);expect(p.filamentGrams).toBe('2.8');expect(p.time).toBe('3m 2s');
 });
 it('honors absolute extrusion and G92 resets',()=>{
  const p=parseGcode('M82\nG92 E0\nG1 X100 Y100 Z.2\nG1 X110 E1\nG1 Y110 E.5\nG92 E0\nG1 X100 E1');
  expect(p.segments).toBe(2);expect(Array.from(p.positions).slice(-6)).toEqual([110,110,expect.closeTo(.2),100,110,expect.closeTo(.2)]);
 });
 it('previews XY arcs using their centers',()=>{
  const p=parseGcode('M83\nG1 X100 Y100 Z.2\nG2 X120 Y100 I10 J0 E1');
  expect(p.segments).toBeGreaterThan(4);expect(p.positions[0]).toBe(100);expect(p.positions[p.positions.length-3]).toBe(120);expect(p.positions[p.positions.length-2]).toBe(100);
 });
});


describe('bounded mobile preview memory',()=>{
 it('parses UTF-8 bytes without changing relative coordinates, CRLF, colors or final metadata',()=>{
  const text='M83\r\nG1 X100 Y100 Z.2\r\nG91\r\n; FEATURE: Support\r\nG1 X10 Y-5 E.3\r\nG90\r\nG1 X100 Y100 E.3\r\n; total filament used [mm] = 2350\r\n; estimated printing time (normal mode) = 1h 3m';
  const bytes=parseGcode(new TextEncoder().encode(text));
  expect(bytes).toEqual(parseGcode(text));expect(bytes.filamentMeters).toBe('2.35');expect(bytes.segments).toBe(2);
  expect(Array.from(bytes.positions.slice(0,6))).toEqual([100,100,expect.closeTo(.2),110,95,expect.closeTo(.2)]);
  expect(bytes.colors[1]).toBeGreaterThan(bytes.colors[0]);
 });
 it('caps typed geometry and samples through the final layer while keeping complete-file estimates',()=>{
  const text='M83\nG1 X0 Y0 Z.2\n'+('G1 X1 E.01\nG1 X0 E.01\n').repeat(MAX_PREVIEW_SEGMENTS/2+50)+'; FEATURE: Support\nG1 X2 Z1.8 E.1\n; total filament used [g] = 12.5\n';
  const preview=parseGcode(new TextEncoder().encode(text));
  expect(preview.segments).toBe(MAX_PREVIEW_SEGMENTS);expect(preview.truncated).toBe(true);
  expect(preview.positions.byteLength+preview.colors.byteLength).toBe(MAX_PREVIEW_SEGMENTS*6*4*2);
  expect(preview.positions.length).toBe(MAX_PREVIEW_SEGMENTS*6);expect(preview.colors.length).toBe(preview.positions.length);
  expect(Array.from(preview.positions.slice(0,6))).toEqual([0,0,expect.closeTo(.2),1,0,expect.closeTo(.2)]);
  expect(Array.from(preview.positions.slice(-6))).toEqual([0,0,expect.closeTo(.2),2,0,expect.closeTo(1.8)]);
  expect(preview.layers.at(-1)).toEqual({z:1.8,end:MAX_PREVIEW_SEGMENTS*2});expect(preview.filamentGrams).toBe('12.5');
  expect(preview.colors.at(-2)).toBeGreaterThan(preview.colors.at(-3)!);
 });
 it('never decodes an oversized byte line and resumes at the next complete line',()=>{
  const input=new TextEncoder().encode(';'+'x'.repeat(2_000_000)+'\nM83\nG1 X0 Y0 Z.2\nG1 X1 E.1\n'+('9'.repeat(MAX_PREVIEW_LINE_LENGTH+1))+'\nG1 X2 E.1');
  const decode=vi.spyOn(TextDecoder.prototype,'decode');
  try{const preview=parseGcode(input);expect(preview.segments).toBe(2);expect(preview.truncated).toBe(true);
    expect(decode.mock.calls.length).toBeGreaterThan(0);
    expect(decode.mock.calls.every(([bytes])=>(bytes?.byteLength??0)<=MAX_PREVIEW_LINE_LENGTH)).toBe(true);
  }finally{decode.mockRestore();}
 });
 it('bounds pathological layer metadata and keeps the final cumulative drawing range',()=>{
  let text='M83\nG1 X0 Y0 Z.2\n';for(let i=0;i<MAX_PREVIEW_LAYERS+5;i++)text+=`G1 X${i%2?0:1} Z${i%2?.4:.2} E.1\n`;
  const preview=parseGcode(text);expect(preview.layers).toHaveLength(MAX_PREVIEW_LAYERS);expect(preview.truncated).toBe(true);
  expect(preview.layers.at(-1)?.end).toBe(preview.segments*2);expect(preview.layers.every((layer,i)=>i===0||layer.end>=preview.layers[i-1].end)).toBe(true);
 });
 it('does not emit infinite coordinates from malformed numbers',()=>{
  const preview=parseGcode('M83\nG1 X0 Y0 Z.2\nG1 X'+'9'.repeat(350)+' E1\nG1 X10 E1');
  expect(preview.segments).toBe(1);expect(preview.truncated).toBe(true);expect(Array.from(preview.positions).every(Number.isFinite)).toBe(true);
 });
 it('renders a closed arc and uses exactly the required typed-array capacity for a small print',()=>{
  const preview=parseGcode(new TextEncoder().encode('M83\nG1 X100 Y100 Z.2\nG2 X100 Y100 I10 J0 E1'));
  expect(preview.segments).toBeGreaterThan(50);expect(preview.truncated).toBe(false);
  expect(preview.positions.byteLength).toBe(preview.segments*6*4);expect(preview.positions.at(-3)).toBe(100);expect(preview.positions.at(-2)).toBe(100);
 });
});
