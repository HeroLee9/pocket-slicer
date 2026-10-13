// End-to-end regression test against the shipped Orca WASM release.
// Run with Node 24+ (native TypeScript stripping): node scripts/test-engine-profiles.mjs
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { runInNewContext } from 'node:vm';
import { buildConfig, getProfileSummary } from '../src/profiles/index.ts';

function binaryStl(vertices, triangles) {
  const bytes = new Uint8Array(84 + triangles.length * 50);
  const view = new DataView(bytes.buffer);
  view.setUint32(80, triangles.length, true);
  triangles.forEach((triangle, index) => {
    triangle.forEach((vertex, corner) => {
      vertices[vertex].forEach((coordinate, axis) => view.setFloat32(84 + index * 50 + 12 + corner * 12 + axis * 4, coordinate, true));
    });
  });
  return bytes;
}
const cube = binaryStl(
  [[-10,-10,0],[10,-10,0],[10,10,0],[-10,10,0],[-10,-10,10],[10,-10,10],[10,10,10],[-10,10,10]],
  [[0,2,1],[0,3,2],[4,5,6],[4,6,7],[0,1,5],[0,5,4],[1,2,6],[1,6,5],[2,3,7],[2,7,6],[3,0,4],[3,4,7]],
);
// Extruded, watertight T: two unsupported shoulders require real supports.
const outline = [[-4,0],[4,0],[4,10],[15,10],[15,13],[-15,13],[-15,10],[-4,10]];
const cap = [[0,1,2],[0,2,7],[7,2,4],[7,4,5],[2,3,4],[7,5,6]];
const tVertices = [-5,5].flatMap(y => outline.map(([x,z]) => [x,y,z]));
const tFaces = [...cap, ...cap.map(([a,b,c]) => [c+8,b+8,a+8])];
for (let a=0; a<8; a++) { const b=(a+1)%8; tFaces.push([a,b+8,b],[a,a+8,b+8]); }
const overhang = binaryStl(tVertices,tFaces);

const validationSource = await readFile(new URL('../public/engine/gcode-validation.js', import.meta.url), 'utf8');
const validateGcodeEnvelope = runInNewContext(validationSource + '\nvalidateGcodeEnvelope;');
const engineDir = new URL('../public/engine/', import.meta.url);
const temp = await mkdtemp(join(tmpdir(), 'pocket-slicer-profile-test-'));
let engine, session;
try {
  const source = await readFile(new URL('slicer-mt.js', engineDir), 'utf8');
  const wasmBinary = Buffer.concat(await Promise.all([0,1].map(part => readFile(new URL(`slicer-mt.wasm.part${part}`, engineDir)))));
  const workerPath = join(temp, 'slicer-mt.cjs');
  await writeFile(workerPath, source);
  globalThis.require ??= createRequire(import.meta.url);
  globalThis.__dirname ??= temp;
  globalThis.__filename ??= workerPath;
  const artifact = (await import(`data:text/javascript;charset=utf-8,${encodeURIComponent(source + '\nexport default OneSlicerEngine;')}`)).default;
  engine = await artifact.createEngine({ runtime: { wasmBinary, mainScriptUrlOrBlob: workerPath } });
  session = await engine.createSession();
  const report = [];
  const scenarios = [
    {label:'PLA 0.4',settings:{material:'PLA'}},
    {label:'PETG 0.4',settings:{material:'PETG'}},
    {label:'ABS 0.4',settings:{material:'ABS'}},
    {label:'PLA 0.6 fine',settings:{nozzle:'0.6',quality:'fine'}},
    {label:'PLA 0.8 draft',settings:{nozzle:'0.8',quality:'draft'}},
    {label:'Solid infill',settings:{infill:100}},
    {label:'Normal overhang supports',settings:{support:'normal'},mesh:overhang,needsSupports:true},
    {label:'Tree overhang supports',settings:{support:'tree'},mesh:overhang,needsSupports:true},
  ];
  for (const {label,settings,mesh=cube,needsSupports=false} of scenarios) {
    const config = buildConfig(settings);
    const summary = getProfileSummary(settings);
    const manifest = {
      schemaVersion:'0.7.0', plates:[{id:'plate-0',label:'Plate 1',index:0}],
      meshes:[{id:'mesh-0',format:'stl',dataRange:{offset:0,length:mesh.length}}],
      objects:[{id:'object-0',meshId:'mesh-0'}],
      instances:[{id:'instance-0',objectId:'object-0',plateId:'plate-0',transform:{matrix:[1,0,0,110,0,1,0,110,0,0,1,0,0,0,0,1]}}],
      modifierVolumes:[],
    };
    await session.init(new TextEncoder().encode(JSON.stringify(config)));
    await session.setObjects(mesh,manifest);
    const result = await session.slice({schemaVersion:'0.7.0',plateSelection:'selected',plateIds:['plate-0'],includeGcode:true,includeStatistics:true});
    const plate = result.plateResults[0];
    const asset = plate.assets.find(item => item.kind==='gcode');
    assert(asset, `${label}: no G-code asset`);
    const bytes = await session.getAsset(asset.id);
    const gcode = new TextDecoder().decode(bytes);
    const verified = validateGcodeEnvelope(gcode);
    assert(verified.depositionMoves > 0, `${label}: validator found no extrusion`);
    assert(gcode.includes(`START_PRINT EXTRUDER_TEMP=${summary.firstLayerNozzleTemperature} BED_TEMP=${summary.firstLayerBedTemperature}`), `${label}: wrong startup temperatures`);
    assert(/^END_PRINT$/m.test(gcode), `${label}: missing END_PRINT`);
    assert(/^M83(?:\s|$)/m.test(gcode) && !/^M82(?:\s|$)/m.test(gcode), `${label}: inconsistent relative extrusion mode`);
    const lines = gcode.split('\n').map(line => line.split(';')[0].trim()).filter(Boolean);
    assert(!lines.filter(line => !line.startsWith('EXCLUDE_OBJECT_DEFINE ')).some(line => /[\[\]{}]/.test(line)), `${label}: unresolved template variables`);
    let moves=0, extrusion=0;
    const envelope={x:[Infinity,-Infinity],y:[Infinity,-Infinity],z:[Infinity,-Infinity]};
    for (const line of lines.filter(line => /^G[0123]\s/.test(line))) {
      moves++;
      // Orca emits fractional G-code numbers without a leading zero (E.02).
      const fields = [...line.matchAll(/(?:^|\s)([XYZE])([-+]?(?:\d*\.)?\d+)/g)];
      for (const [,axis,raw] of fields) {
        const value=Number(raw);
        if (axis==='E') { if(value>0) extrusion+=value; continue; }
        assert(value>=0 && value<=(axis==='Z'?250:220), `${label}: movement outside K1C envelope: ${line}`);
        const bounds=envelope[axis.toLowerCase()];
        bounds[0]=Math.min(bounds[0],value); bounds[1]=Math.max(bounds[1],value);
      }
    }
    assert(moves>100 && extrusion>0, `${label}: missing print toolpath`);
    if(needsSupports) assert(/;TYPE:Support(?: interface)?/i.test(gcode), `${label}: no support toolpath generated`);
    assert(plate.statistics.filament.totalLengthMm>0 && plate.statistics.timeSeconds.normal>0, `${label}: missing Orca statistics`);
    const row={label,settings,bytes:bytes.length,moves,extrusion,envelope,summary,statistics:plate.statistics};
    report.push(row);
    console.log(`PASS ${label}: ${bytes.length} G-code bytes, ${moves} moves, ${plate.statistics.filament.totalLengthMm.toFixed(1)} mm filament`);
  }
  const reportArg = process.argv.indexOf('--report');
  if (reportArg>=0) await writeFile(process.argv[reportArg+1],JSON.stringify(report,null,2)+'\n');
  console.log(`${report.length} real Orca slicing scenarios passed.`);
} finally {
  await session?.dispose();
  await engine?.dispose();
  await rm(temp,{recursive:true,force:true});
}
