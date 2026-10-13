import * as THREE from 'three';
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js';
import { STLExporter } from 'three/examples/jsm/exporters/STLExporter.js';
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js';
import { ThreeMFLoader } from 'three/examples/jsm/loaders/3MFLoader.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

export type Model = { name:string; geometry:THREE.BufferGeometry; triangles:number; notice?:string };
export type Transform = {scale:number; x:number; y:number; z:number};
export const DEFAULT_TRANSFORM:Transform = {scale:100,x:0,y:0,z:0};
const MAX_TRIANGLES = 1_000_000;

function validateGeometry(geometry:THREE.BufferGeometry) {
  const p = geometry.getAttribute('position');
  if (!p || p.count < 3 || p.count % 3 !== 0) throw new Error('This file has no usable triangular mesh. Export the model as an STL and try again.');
  if (p.count / 3 > MAX_TRIANGLES) throw new Error('This model exceeds 1 million triangles. Simplify the mesh before slicing on a phone.');
  for (let i=0;i<p.array.length;i++) if (!Number.isFinite(p.array[i])) throw new Error('The model contains invalid coordinates. Repair or re-export the mesh.');
  geometry.computeBoundingBox();
  const size=geometry.boundingBox!.getSize(new THREE.Vector3());
  if (Math.min(size.x,size.y,size.z) <= 0) throw new Error('The model is flat or empty. A solid 3D mesh is needed.');
  const center=geometry.boundingBox!.getCenter(new THREE.Vector3());
  geometry.translate(-center.x,-center.y,-center.z);
  geometry.computeVertexNormals();
  return geometry;
}
export async function readModel(file:File):Promise<Model> {
  const ext=file.name.match(/\.(stl|obj|3mf)$/i)?.[1].toLowerCase();
  if (!ext) throw new Error('Choose an STL, OBJ, or 3MF model.');
  if (file.size > 50*1024*1024) throw new Error('Choose a model under 50 MB for mobile slicing.');
  const bytes=await file.arrayBuffer();
  let geometry:THREE.BufferGeometry;
  let notice:string|undefined;
  if (ext==='stl') {try{geometry=new STLLoader().parse(bytes);}catch{throw new Error('This STL is incomplete or could not be read. Re-export it as a binary STL and try again.');}}
  else if (ext==='obj' || ext==='3mf') {
    const group=ext==='obj'?new OBJLoader().parse(new TextDecoder().decode(bytes)):new ThreeMFLoader().parse(bytes);
    const parts:THREE.BufferGeometry[]=[];
    group.updateMatrixWorld(true);
    group.traverse((child)=>{
      if (child instanceof THREE.Mesh) {
        let g=child.geometry.clone();
        if (g.index) {const n=g.toNonIndexed();g.dispose();g=n;}
        for (const name of Object.keys(g.attributes)) if(name!=='position')g.deleteAttribute(name);
        g.applyMatrix4(child.matrixWorld);
        parts.push(g);
      }
    });
    if (!parts.length) throw new Error('No mesh found in this model.');
    geometry=mergeGeometries(parts)!;
    parts.forEach(p=>p.dispose());
    if (!geometry) throw new Error('The meshes could not be combined. Export an STL instead.');
    notice=ext==='3mf'?'3MF geometry imported. Embedded print settings, colors, modifiers, and support painting are not imported. All objects form one model.':parts.length>1?'The objects in this file are combined into one model.':undefined;
  } else throw new Error('Choose an STL, OBJ, or 3MF model.');
  if(geometry.index) {const n=geometry.toNonIndexed();geometry.dispose();geometry=n;}
  try { validateGeometry(geometry); } catch(e) {geometry.dispose();throw e;}
  return {name:file.name,geometry,triangles:geometry.getAttribute('position').count/3,notice};
}
export function cubeModel():Model {
  let g:THREE.BufferGeometry=new THREE.BoxGeometry(20,20,20);
  const n=g.toNonIndexed();g.dispose();g=n;
  return {name:'calibration-cube.stl',geometry:validateGeometry(g),triangles:12};
}
export function transformedGeometry(model:Model,t:Transform):THREE.BufferGeometry {
  if (![t.scale,t.x,t.y,t.z].every(Number.isFinite) || t.scale<=0) throw new Error('Enter a positive scale and valid rotation angles.');
  const g=model.geometry.clone();
  const matrix=new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(t.x*Math.PI/180,t.y*Math.PI/180,t.z*Math.PI/180));
  matrix.scale(new THREE.Vector3().setScalar(t.scale/100));
  g.applyMatrix4(matrix);g.computeBoundingBox();
  const box=g.boundingBox!,c=box.getCenter(new THREE.Vector3());
  g.translate(110-c.x,110-c.y,-box.min.z);g.computeBoundingBox();
  return g;
}
export function modelDimensions(model:Model,t:Transform):[number,number,number] {
  const g=transformedGeometry(model,t);const v=g.boundingBox!.getSize(new THREE.Vector3());g.dispose();return [v.x,v.y,v.z];
}
export function modelSTL(model:Model,t:Transform):ArrayBuffer {
  const g=transformedGeometry(model,t);
  const material=new THREE.MeshBasicMaterial();
  const data=new STLExporter().parse(new THREE.Mesh(g,material),{binary:true});
  g.dispose();material.dispose();
  return data.buffer.slice(data.byteOffset,data.byteOffset+data.byteLength) as ArrayBuffer;
}
