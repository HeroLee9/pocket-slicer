import {describe,it,expect} from 'vitest';
import * as THREE from 'three';
import {STLLoader} from 'three/examples/jsm/loaders/STLLoader.js';
import {mergeGeometries} from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type {Model} from '../src/lib/model';
import {DEFAULT_OBJECT_TRANSFORM,placedGeometry,objectBounds,plateBounds,plateSTL,validatePlate,arrangePlate,rotateObject,layOnFace,autoOrient,type ObjectTransform,type PlateObject} from '../src/lib/geometry';

function box(x=20,y=20,z=20):Model{const original=new THREE.BoxGeometry(x,y,z),geometry=original.toNonIndexed();original.dispose();return {name:'box.stl',geometry,triangles:12};}
function t(value:Partial<ObjectTransform>={}):ObjectTransform{return {...DEFAULT_OBJECT_TRANSFORM,...value};}
function object(id:string,model=box(),transform=t()):PlateObject{return {id,model,transform};}
function volume(geometry:THREE.BufferGeometry){const p=geometry.getAttribute('position'),a=new THREE.Vector3(),b=new THREE.Vector3(),c=new THREE.Vector3();let value=0;for(let i=0;i<p.count;i+=3){a.fromBufferAttribute(p,i);b.fromBufferAttribute(p,i+1);c.fromBufferAttribute(p,i+2);value+=a.dot(b.cross(c))/6;}return value;}

describe('model manipulation in bed coordinates',()=>{
  it('combines independent and uniform scale, rotation, XY position and Z lift without changing the source',()=>{
    const model=box(20,30,40),before=Array.from(model.geometry.getAttribute('position').array);
    const transform=t({scale:200,scaleX:50,scaleY:200,scaleZ:25,x:90,positionX:60,positionY:130,positionZ:5});
    const bounds=objectBounds(model,transform),g=placedGeometry(model,transform);
    expect(bounds.size[0]).toBeCloseTo(20);expect(bounds.size[1]).toBeCloseTo(20);expect(bounds.size[2]).toBeCloseTo(120);
    bounds.min.forEach((value,i)=>expect(value).toBeCloseTo([50,120,5][i]));expect(bounds.max[2]).toBeCloseTo(125);
    expect(g.boundingBox!.min.z).toBeCloseTo(5);expect(g.boundingBox!.getCenter(new THREE.Vector3()).x).toBeCloseTo(60);
    expect(Array.from(model.geometry.getAttribute('position').array)).toEqual(before);g.dispose();model.geometry.dispose();
  });
  it('keeps outward triangle winding for one or three mirrored axes',()=>{
    const model=box(12,20,30);
    for(const mirror of [{mirrorX:true},{mirrorX:true,mirrorY:true,mirrorZ:true},{mirrorX:true,mirrorZ:true}]){
      const g=placedGeometry(model,t(mirror));expect(volume(g)).toBeCloseTo(7200,3);g.dispose();
    }
    model.geometry.dispose();
  });
  it('serializes multiple actual placements without moving their combined center',()=>{
    const model=box(10,10,10),objects=[object('a',model,t({positionX:30,positionY:40})),object('b',model,t({positionX:160,positionY:170,mirrorX:true}))];
    const data=plateSTL(objects),parsed=new STLLoader().parse(data);parsed.computeBoundingBox();
    expect(new DataView(data).getUint32(80,true)).toBe(24);
    expect(parsed.boundingBox!.min.toArray()).toEqual([25,35,0]);expect(parsed.boundingBox!.max.toArray()).toEqual([165,175,10]);
    expect(volume(parsed)).toBeCloseTo(2000,3);expect(plateBounds(objects)?.center).toEqual([95,105,5]);
    parsed.dispose();model.geometry.dispose();
  });
  it('checks moved coordinates and brim, and reports overlapping boxes and floating models',()=>{
    const model=box();
    expect(validatePlate([object('a',model,t({positionX:15}))],{brim:5}).errors).toHaveLength(1);
    expect(validatePlate([object('a',model,t({positionX:15.5}))],{brim:5}).errors).toEqual([]);
    const result=validatePlate([object('a',model),object('b',model,t({positionX:115,positionZ:2}))]);
    expect(result.errors).toEqual([]);expect(result.warnings.some(s=>s.includes('overlap'))).toBe(true);expect(result.warnings.some(s=>s.includes('lifted'))).toBe(true);
    expect(validatePlate([object('a',model,t({positionZ:-1}))]).errors[0]).toMatch(/below the bed/);
    model.geometry.dispose();
  });
  it('arranges a group with space between brims while retaining source transforms',()=>{
    const model=box(40,30,15),objects=Array.from({length:9},(_,i)=>object(String(i),model,t({positionZ:5})));
    const arranged=arrangePlate(objects,{brim:4,gap:6}),bounds=plateBounds(arranged)!;
    expect(validatePlate(arranged,{brim:4})).toEqual({errors:[],warnings:[]});
    expect(bounds.center[0]).toBeCloseTo(110);expect(bounds.center[1]).toBeCloseTo(110);
    expect(arranged.every(o=>o.transform.positionZ===0)).toBe(true);expect(objects.every(o=>o.transform.positionX===110&&o.transform.positionZ===5)).toBe(true);
    expect(()=>arrangePlate(Array.from({length:4},(_,i)=>object(String(i),box(150,150,20))))).toThrow(/do not fit/);
    model.geometry.dispose();
  });
  it('flips using world rotations and lays selected faces on the plate, including mirrors',()=>{
    const model=box(20,30,40),flipped=rotateObject(t(), 'x',180);
    expect(objectBounds(model,flipped).size[2]).toBeCloseTo(40);
    const laid=layOnFace(model,t(),0);expect(objectBounds(model,laid).size[2]).toBeCloseTo(20);
    const mirrored=layOnFace(model,t({mirrorX:true,scaleX:200}),0),g=placedGeometry(model,mirrored);
    expect(objectBounds(model,mirrored).size[2]).toBeCloseTo(40);expect(g.getAttribute('normal').getZ(0)).toBeCloseTo(-1);
    expect(g.getAttribute('position').getZ(0)).toBeCloseTo(0);g.dispose();model.geometry.dispose();
  });
  it('does not pretend an interior face can contact the bed',()=>{
    const model=box(),inside=new THREE.BufferGeometry();inside.setAttribute('position',new THREE.Float32BufferAttribute([0,0,0,1,0,0,0,1,0],3));
    const g=mergeGeometries([model.geometry.clone().deleteAttribute('normal').deleteAttribute('uv'),inside])!;
    expect(()=>layOnFace({name:'interior',geometry:g,triangles:13},t(),12)).toThrow(/below it/);
    g.dispose();inside.dispose();model.geometry.dispose();
  });
});

describe('face-aware automatic orientation',()=>{
  it('finds a diagonal planar base, not just the six axis-aligned sides',()=>{
    const model=box(10,40,3);model.geometry.rotateX(32*Math.PI/180);model.geometry.rotateY(17*Math.PI/180);
    const progress:number[]=[];const result=autoOrient(model,t(),{onProgress:(done)=>progress.push(done)});
    expect(result.summary.candidates).toBeGreaterThan(6);expect(result.summary.height).toBeCloseTo(3,4);
    expect(result.summary.contactArea).toBeCloseTo(400,3);expect(result.summary.overhangArea).toBeCloseTo(0);
    expect(Math.abs(result.transform.x)+Math.abs(result.transform.y)).toBeGreaterThan(1);
    expect(progress.at(-1)).toBe(result.summary.candidates);expect(validatePlate([object('a',model,result.transform)]).errors).toEqual([]);
    model.geometry.dispose();
  });
  it('prefers a stable broad face and honors nonuniform scales and mirroring',()=>{
    const model=box(12,30,60),result=autoOrient(model,t({mirrorX:true,scaleY:200}));
    expect(result.summary.height).toBeCloseTo(12);expect(result.summary.contactArea).toBeCloseTo(3600);
    expect(result.transform.mirrorX).toBe(true);expect(result.transform.scaleY).toBe(200);
    model.geometry.dispose();
  });
  it('aligns face sides instead of diagonals so a large square can lie flat within the bed',()=>{
    const model=box(200,200,8);model.geometry.rotateZ(Math.PI/4);
    const result=autoOrient(model,t());
    const bounds=objectBounds(model,result.transform);
    expect(bounds.size[0]).toBeCloseTo(200,3);expect(bounds.size[1]).toBeCloseTo(200,3);expect(bounds.size[2]).toBeCloseTo(8,3);
    expect(validatePlate([object('a',model,result.transform)],{brim:5}).errors).toEqual([]);
    model.geometry.dispose();
  });
  it('evaluates unsupported faces above the bed, not just height',()=>{
    const parts=[box(10,20,40).geometry.translate(-20,0,20),box(10,20,40).geometry.translate(20,0,20),box(50,20,10).geometry.translate(0,0,45)];
    const geometry=mergeGeometries(parts)!,model={name:'bridge',geometry,triangles:36};
    const result=autoOrient(model,t());
    expect(result.summary.overhangArea).toBeCloseTo(0);expect(result.summary.contactArea).toBeGreaterThan(500);
    expect(validatePlate([object('a',model,result.transform)]).errors).toEqual([]);
    parts.forEach(g=>g.dispose());geometry.dispose();
  });
  it('rejects transforms and positions that cannot produce a printable placement',()=>{
    const model=box(20,30,40);
    expect(()=>autoOrient(model,t({positionX:-100}))).toThrow(/Center or scale/);
    expect(()=>placedGeometry(model,t({scaleX:0}))).toThrow(/greater than zero/);
    expect(()=>objectBounds(model,t({positionY:NaN}))).toThrow(/valid numbers/);
    model.geometry.dispose();
  });
});
