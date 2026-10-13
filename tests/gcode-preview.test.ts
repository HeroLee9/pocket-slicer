import {describe,it,expect} from 'vitest';
import {parseGcode} from '../src/lib/gcode';

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
