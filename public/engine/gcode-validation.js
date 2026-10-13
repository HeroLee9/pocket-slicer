/* Validate explicit Orca toolpaths before permitting export. Firmware macros
 * (START_PRINT/END_PRINT) execute on the printer and are not expanded here. */
'use strict';
function validateGcodeEnvelope(gcode, limits = { x: 220, y: 220, z: 250 }) {
  const EPS = 1e-6, TAU = Math.PI * 2;
  const size = [limits.x, limits.y, limits.z];
  if (!size.every(value => Number.isFinite(value) && value > 0)) throw new Error('Invalid printer build volume.');
  let position = [null, null, null], origin = [0, 0, 0];
  let absolute = true, relativeE = false, absoluteArcCenter = false, ePosition = 0, units = 1;
  let plane = 'G17', motion = null, moveCount = 0, depositionMoves = 0;
  const envelope = { x: [Infinity, -Infinity], y: [Infinity, -Infinity], z: [Infinity, -Infinity] };
  const fail = (line, message) => {
    const error = new Error(`${message} (G-code line ${line}). Reduce scale or brim width, or adjust supports before saving.`);
    error.code = 'VALIDATION';
    throw error;
  };
  const check = (point, line) => {
    point.forEach((value, axis) => {
      if (value === null) return;
      if (!Number.isFinite(value) || value < -EPS || value > size[axis] + EPS) {
        fail(line, `The generated toolpath exceeds the K1C build volume: ${'XYZ'[axis]}=${Number(value).toFixed(3)} mm`);
      }
      const range = envelope['xyz'[axis]];
      range[0] = Math.min(range[0], value); range[1] = Math.max(range[1], value);
    });
  };
  const normalized = angle => ((angle % TAU) + TAU) % TAU;
  const sweepBetween = (start, end, clockwise) => normalized(clockwise ? start - end : end - start);
  // Iterate without retaining another full array of lines for large iPhone jobs.
  let offset = 0, lineNumber = 0;
  while (offset < gcode.length) {
    const end = gcode.indexOf('\n', offset);
    const raw = gcode.slice(offset, end < 0 ? gcode.length : end);
    offset = end < 0 ? gcode.length : end + 1;
    lineNumber++;
    let line = raw.split(';')[0].replace(/\([^)]*\)/g, '').trim().toUpperCase();
    if (!line) continue;
    line = line.replace(/^N\d+\s*/, '').replace(/\*\d+\s*$/, '').trim();
    const opcode = line.match(/^([GMT]\d+(?:\.\d+)?)(?=\s|[A-Z]|$)/);
    let command, payload;
    if (opcode) { command = opcode[1]; payload = line.slice(command.length); }
    else if (/^[XYZEFIJR][-+.\d]/.test(line) && motion) { command = motion; payload = line; }
    else continue; // Named Klipper macros / SET_VELOCITY_LIMIT have no explicit path.
    const fields = {};
    for (const match of payload.matchAll(/([A-Z])([-+]?(?:\d*\.)?\d+)/g)) fields[match[1]] = Number(match[2]);
    if (command === 'G20') { units = 25.4; continue; }
    if (command === 'G21') { units = 1; continue; }
    if (command === 'G90') { absolute = true; continue; }
    if (command === 'G91') { absolute = false; continue; }
    if (command === 'M82') { relativeE = false; continue; }
    if (command === 'M83') { relativeE = true; continue; }
    if (command === 'G90.1') { absoluteArcCenter = true; continue; }
    if (command === 'G91.1') { absoluteArcCenter = false; continue; }
    if (['G17', 'G18', 'G19'].includes(command)) { plane = command; continue; }
    if (command === 'G92') {
      // G92 changes logical coordinates, never moves the printhead. Preserve
      // physical position with an origin offset when XYZ is reset.
      for (let axis=0; axis<3; axis++) {
        const key = 'XYZ'[axis];
        if (fields[key] !== undefined) {
          if (position[axis] === null) fail(lineNumber, 'Cannot verify an XYZ origin reset before the first position');
          origin[axis] = position[axis] - fields[key] * units;
        }
      }
      if (fields.E !== undefined) ePosition = fields.E * units;
      continue;
    }
    if (command === 'G28') {
      // Homing is firmware-controlled; subsequent absolute coordinates restore
      // known positions. Never guess a homing coordinate for relative moves.
      const axes = payload.match(/[XYZ]/g) ?? ['X', 'Y', 'Z'];
      axes.forEach(key => { position['XYZ'.indexOf(key)] = null; origin['XYZ'.indexOf(key)] = 0; });
      continue;
    }
    if (!['G0','G00','G1','G01','G2','G02','G3','G03'].includes(command)) continue;
    if (payload.replace(/([A-Z])([-+]?(?:\d*\.)?\d+)/g, '').trim()) fail(lineNumber, 'The toolpath contains an unreadable movement');
    motion = command;
    const previous = position.slice();
    const next = position.slice();
    for (let axis=0; axis<3; axis++) {
      const value = fields['XYZ'[axis]];
      if (value === undefined) continue;
      if (!absolute && previous[axis] === null) fail(lineNumber, 'Cannot verify a relative movement before the first absolute position');
      next[axis] = value * units + (absolute ? origin[axis] : previous[axis]);
    }
    check(next, lineNumber);
    const isArc = ['G2','G02','G3','G03'].includes(command);
    if (isArc) {
      if (plane !== 'G17') fail(lineNumber, 'Only XY arc toolpaths can be verified');
      if ([previous[0],previous[1],next[0],next[1]].some(value => value === null)) fail(lineNumber, 'An arc starts before its position is known');
      const clockwise = ['G2','G02'].includes(command);
      let cx, cy;
      if (fields.R !== undefined) {
        const radius = Math.abs(fields.R * units), dx=next[0]-previous[0], dy=next[1]-previous[1];
        const chord=Math.hypot(dx,dy);
        if (chord < EPS || chord > radius * 2 + EPS) fail(lineNumber, 'The toolpath contains an invalid radius arc');
        const height=Math.sqrt(Math.max(0,radius*radius-chord*chord/4));
        const candidates=[1,-1].map(sign => [
          (previous[0]+next[0])/2-sign*dy/chord*height,
          (previous[1]+next[1])/2+sign*dx/chord*height,
        ]);
        [cx,cy] = candidates.find(([x,y]) => {
          const sweep=sweepBetween(Math.atan2(previous[1]-y,previous[0]-x),Math.atan2(next[1]-y,next[0]-x),clockwise);
          return fields.R >= 0 ? sweep <= Math.PI + EPS : sweep >= Math.PI - EPS;
        }) ?? candidates[0];
      } else {
        if (fields.I === undefined && fields.J === undefined) fail(lineNumber, 'The toolpath contains an arc with no center');
        cx=absoluteArcCenter ? (fields.I ?? (previous[0]-origin[0])/units)*units+origin[0] : previous[0]+(fields.I??0)*units;
        cy=absoluteArcCenter ? (fields.J ?? (previous[1]-origin[1])/units)*units+origin[1] : previous[1]+(fields.J??0)*units;
      }
      const radius=Math.hypot(previous[0]-cx,previous[1]-cy);
      const endRadius=Math.hypot(next[0]-cx,next[1]-cy);
      if (radius<EPS || Math.abs(radius-endRadius)>0.05) fail(lineNumber, 'The toolpath contains an inconsistent arc');
      const startAngle=Math.atan2(previous[1]-cy,previous[0]-cx);
      const endAngle=Math.atan2(next[1]-cy,next[0]-cx);
      const fullCircle=Math.hypot(next[0]-previous[0],next[1]-previous[1])<EPS || (fields.P??1)>1;
      const sweep=fullCircle?TAU:sweepBetween(startAngle,endAngle,clockwise);
      // Endpoints alone miss arcs whose middle crosses the edge of the bed.
      for (const angle of [0,Math.PI/2,Math.PI,Math.PI*1.5]) {
        if (fullCircle || sweepBetween(startAngle,angle,clockwise)<=sweep+EPS) check([cx+radius*Math.cos(angle),cy+radius*Math.sin(angle),null],lineNumber);
      }
    }
    const hasSpatialMove = isArc || next.some((value,axis) => value !== null && value !== previous[axis]);
    if (fields.E !== undefined) {
      const nextE = fields.E * units;
      const extruded = relativeE ? nextE : nextE-ePosition;
      ePosition = relativeE ? ePosition+nextE : nextE;
      if (extruded > EPS && hasSpatialMove) {
        if (next.some(value => value === null)) fail(lineNumber, 'Extrusion starts before all three axes are positioned');
        depositionMoves++;
      }
    }
    position = next;
    if (hasSpatialMove) moveCount++;
  }
  if (!depositionMoves) fail(lineNumber, 'The sliced file contains no deposition moves');
  return { envelope, moveCount, depositionMoves };
}
