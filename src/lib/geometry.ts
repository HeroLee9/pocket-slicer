import * as THREE from 'three';
import type {Model,Transform} from './model';

export type Axis='x'|'y'|'z';
export type Triple=[number,number,number];
export type ObjectTransform=Transform & {
  scaleX:number;scaleY:number;scaleZ:number;
  positionX:number;positionY:number;positionZ:number;
  mirrorX:boolean;mirrorY:boolean;mirrorZ:boolean;
};
export type PlateObject={id:string;model:Model;transform:ObjectTransform};
export type Bounds={min:Triple;max:Triple;size:Triple;center:Triple};
export type PlateOptions={brim?:number;gap?:number;bedSize?:Triple};
export const DEFAULT_OBJECT_TRANSFORM:ObjectTransform={scale:100,x:0,y:0,z:0,scaleX:100,scaleY:100,scaleZ:100,positionX:110,positionY:110,positionZ:0,mirrorX:false,mirrorY:false,mirrorZ:false};
export const PRESERVE_PLACEMENT_MATRIX=[1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1];
const radians=Math.PI/180;
const MAX_TRIANGLES=1_000_000;
const down=new THREE.Vector3(0,0,-1);

function checked(t:ObjectTransform):ObjectTransform {
  const value={...DEFAULT_OBJECT_TRANSFORM,...t};
  const numbers=[value.scale,value.scaleX,value.scaleY,value.scaleZ,value.x,value.y,value.z,value.positionX,value.positionY,value.positionZ];
  if(!numbers.every(Number.isFinite))throw new Error('Enter valid numbers for position, rotation, and scale.');
  if([value.scale,value.scaleX,value.scaleY,value.scaleZ].some(n=>n<=0))throw new Error('Scale must be greater than zero. Use Mirror to flip a model.');
  if(value.positionZ<0)throw new Error('The bottom of the model cannot be below the bed. Set Z to zero or higher.');
  return value;
}
function scaling(t:ObjectTransform):THREE.Vector3 {
  return new THREE.Vector3(t.scale*t.scaleX/10000*(t.mirrorX?-1:1),t.scale*t.scaleY/10000*(t.mirrorY?-1:1),t.scale*t.scaleZ/10000*(t.mirrorZ?-1:1));
}
function rotation(t:ObjectTransform):THREE.Quaternion {return new THREE.Quaternion().setFromEuler(new THREE.Euler(t.x*radians,t.y*radians,t.z*radians,'XYZ'));}
function linearMatrix(t:ObjectTransform):THREE.Matrix4 {return new THREE.Matrix4().compose(new THREE.Vector3(),rotation(t),scaling(t));}
function rotationResult(t:ObjectTransform,q:THREE.Quaternion):ObjectTransform {
  const e=new THREE.Euler().setFromQuaternion(q.normalize(),'XYZ');
  const degree=(n:number)=>Math.abs(n/radians)<1e-8?0:n/radians;
  return {...t,x:degree(e.x),y:degree(e.y),z:degree(e.z)};
}
function rawBounds(model:Model,matrix:THREE.Matrix4):THREE.Box3 {
  const positions=model.geometry.getAttribute('position');
  if(!positions||positions.count<3)throw new Error('The model has no usable mesh.');
  const box=new THREE.Box3(),v=new THREE.Vector3();
  for(let i=0;i<positions.count;i++)box.expandByPoint(v.fromBufferAttribute(positions,i).applyMatrix4(matrix));
  if(![...box.min.toArray(),...box.max.toArray()].every(Number.isFinite))throw new Error('This transform produces invalid model coordinates.');
  return box;
}
function boundsValue(box:THREE.Box3):Bounds {
  return {min:box.min.toArray() as Triple,max:box.max.toArray() as Triple,size:box.getSize(new THREE.Vector3()).toArray() as Triple,center:box.getCenter(new THREE.Vector3()).toArray() as Triple};
}
export function objectBounds(model:Model,transform:ObjectTransform):Bounds {
  const t=checked(transform),box=rawBounds(model,linearMatrix(t)),size=box.getSize(new THREE.Vector3());
  return boundsValue(new THREE.Box3(new THREE.Vector3(t.positionX-size.x/2,t.positionY-size.y/2,t.positionZ),new THREE.Vector3(t.positionX+size.x/2,t.positionY+size.y/2,t.positionZ+size.z)));
}
/** Fresh geometry in bed coordinates. The caller owns and must dispose it. */
export function placedGeometry(model:Model,transform:ObjectTransform):THREE.BufferGeometry {
  const t=checked(transform),g=model.geometry.index?model.geometry.toNonIndexed():model.geometry.clone();
  try {
    for(const name of Object.keys(g.attributes))if(name!=='position')g.deleteAttribute(name);
    g.applyMatrix4(linearMatrix(t));
    const p=g.getAttribute('position');
    if(p.count%3)throw new Error('The model contains incomplete triangles.');
    if(Number(t.mirrorX)+Number(t.mirrorY)+Number(t.mirrorZ)===1||Number(t.mirrorX)+Number(t.mirrorY)+Number(t.mirrorZ)===3){
      const a=new THREE.Vector3(),b=new THREE.Vector3();
      for(let i=0;i<p.count;i+=3){a.fromBufferAttribute(p,i+1);b.fromBufferAttribute(p,i+2);p.setXYZ(i+1,b.x,b.y,b.z);p.setXYZ(i+2,a.x,a.y,a.z);}
    }
    g.computeBoundingBox();
    const box=g.boundingBox!,center=box.getCenter(new THREE.Vector3());
    if(![...box.min.toArray(),...box.max.toArray()].every(Number.isFinite))throw new Error('This transform produces invalid model coordinates.');
    g.translate(t.positionX-center.x,t.positionY-center.y,t.positionZ-box.min.z);
    g.computeVertexNormals();g.computeBoundingBox();
    return g;
  }catch(error){g.dispose();throw error;}
}
export function plateBounds(objects:PlateObject[]):Bounds|null {
  if(!objects.length)return null;
  const box=new THREE.Box3();
  for(const object of objects){const b=objectBounds(object.model,object.transform);box.union(new THREE.Box3(new THREE.Vector3(...b.min),new THREE.Vector3(...b.max)));}
  return boundsValue(box);
}
/** Bakes all placements into one same-material STL, without centering the plate. */
export function plateSTL(objects:PlateObject[]):ArrayBuffer {
  if(!objects.length)throw new Error('Add a model to the plate before slicing.');
  const count=objects.reduce((n,o)=>n+(o.model.geometry.index?.count??o.model.geometry.getAttribute('position').count)/3,0);
  if(!Number.isInteger(count)||count<=0||count>MAX_TRIANGLES)throw new Error('The plate must contain between 1 and 1 million triangles.');
  const buffer=new ArrayBuffer(84+count*50),view=new DataView(buffer);view.setUint32(80,count,true);
  const a=new THREE.Vector3(),b=new THREE.Vector3(),c=new THREE.Vector3(),normal=new THREE.Vector3(),edge=new THREE.Vector3();
  let offset=84;
  for(const object of objects){
    const g=placedGeometry(object.model,object.transform);
    try{
      const p=g.getAttribute('position');
      for(let i=0;i<p.count;i+=3){
        a.fromBufferAttribute(p,i);b.fromBufferAttribute(p,i+1);c.fromBufferAttribute(p,i+2);
        normal.subVectors(b,a).cross(edge.subVectors(c,a)).normalize();
        for(const vector of [normal,a,b,c])for(const number of vector.toArray()){view.setFloat32(offset,number,true);offset+=4;}
        view.setUint16(offset,0,true);offset+=2;
      }
    }finally{g.dispose();}
  }
  return buffer;
}
function plateOptions(options:PlateOptions){
  const bedSize=options.bedSize??[220,220,250] as Triple,brim=options.brim??0,gap=options.gap??6;
  if(!bedSize.every(n=>Number.isFinite(n)&&n>0)||!Number.isFinite(brim)||brim<0||!Number.isFinite(gap)||gap<0)throw new Error('Bed dimensions, brim, and spacing must be valid nonnegative values.');
  return {bedSize,brim,gap,margin:brim+0.5};
}
export function validatePlate(objects:PlateObject[],options:PlateOptions={}):{errors:string[];warnings:string[]} {
  const errors:string[]=[],warnings:string[]=[],bounds:{object:PlateObject;bounds:Bounds}[]=[];
  const {bedSize,margin}=plateOptions(options),ids=new Set<string>();let triangles=0;
  if(!objects.length)return {errors:['Add a model to the plate.'],warnings};
  for(const object of objects){
    if(ids.has(object.id))errors.push('Each object on the plate must have a unique ID.');ids.add(object.id);triangles+=object.model.triangles;
    try{
      const b=objectBounds(object.model,object.transform);bounds.push({object,bounds:b});
      if(b.min[0]<margin-0.001||b.min[1]<margin-0.001||b.max[0]>bedSize[0]-margin+0.001||b.max[1]>bedSize[1]-margin+0.001||b.max[2]>bedSize[2]+0.001)errors.push(`${object.model.name} or its brim extends outside the ${bedSize.join(' × ')} mm build volume. Move, rotate, or scale it.`);
      if(b.min[2]>0.001)warnings.push(`${object.model.name} is lifted above the bed. Use supports or set Z to 0.`);
    }catch(error){errors.push(`${object.model.name}: ${error instanceof Error?error.message:String(error)}`);}
  }
  if(triangles>MAX_TRIANGLES)errors.push('The combined plate exceeds 1 million triangles. Remove or simplify a model.');
  for(let i=0;i<bounds.length;i++)for(let j=i+1;j<bounds.length;j++){
    const a=bounds[i],b=bounds[j];
    const overlap=a.bounds.min[0]<b.bounds.max[0]&&a.bounds.max[0]>b.bounds.min[0]&&a.bounds.min[1]<b.bounds.max[1]&&a.bounds.max[1]>b.bounds.min[1];
    if(overlap)warnings.push(`${a.object.model.name} and ${b.object.model.name} overlap in their XY bounding boxes. Check that the parts do not intersect.`);
    else if(a.bounds.min[0]-margin<b.bounds.max[0]+margin&&a.bounds.max[0]+margin>b.bounds.min[0]-margin&&a.bounds.min[1]-margin<b.bounds.max[1]+margin&&a.bounds.max[1]+margin>b.bounds.min[1]-margin)warnings.push(`The brims of ${a.object.model.name} and ${b.object.model.name} may overlap.`);
  }
  return {errors,warnings};
}
export function rotateObject(transform:ObjectTransform,axis:Axis,degrees:number):ObjectTransform {
  const t=checked(transform);if(!Number.isFinite(degrees))throw new Error('Enter a valid rotation angle.');
  const direction=new THREE.Vector3(axis==='x'?1:0,axis==='y'?1:0,axis==='z'?1:0);
  return rotationResult(t,new THREE.Quaternion().setFromAxisAngle(direction,degrees*radians).multiply(rotation(t)));
}
export function layOnFace(model:Model,transform:ObjectTransform,face:number|Triple):ObjectTransform {
  const t=checked(transform),normal=new THREE.Vector3();let point:THREE.Vector3|undefined;
  if(typeof face==='number'){
    const p=model.geometry.getAttribute('position'),index=model.geometry.index;
    if(!Number.isInteger(face)||face<0||face*3+2>=(index?.count??p.count))throw new Error('Choose a valid face on the model.');
    const vertex=(i:number)=>new THREE.Vector3().fromBufferAttribute(p,index?index.getX(face*3+i):face*3+i);
    const a=vertex(0),b=vertex(1),c=vertex(2);point=a.clone();
    normal.subVectors(b,a).cross(c.sub(a)).normalize().applyNormalMatrix(new THREE.Matrix3().getNormalMatrix(linearMatrix(t)));
  }else normal.set(...face).normalize();
  if(!normal.toArray().every(Number.isFinite)||normal.lengthSq()<0.5)throw new Error('Choose a flat, non-degenerate face.');
  const q=new THREE.Quaternion().setFromUnitVectors(normal,down).multiply(rotation(t));
  const result={...rotationResult(t,q),positionZ:0};
  if(point){const matrix=linearMatrix(result),box=rawBounds(model,matrix),z=point.applyMatrix4(matrix).z;if(z-box.min.z>0.03)throw new Error('That face cannot rest on the bed without part of the model extending below it. Choose an outer face.');}
  return result;
}

type Rect={x:number;y:number;w:number;h:number};
/** Packs fixed orientations with a gap, then centers the complete arrangement. */
export function arrangePlate(objects:PlateObject[],options:PlateOptions={}):PlateObject[] {
  const {bedSize,margin,gap}=plateOptions(options);
  const spacing=gap+2*margin;
  const items=objects.map(object=>({object,size:objectBounds(object.model,object.transform).size})).sort((a,b)=>Math.max(b.size[0],b.size[1])-Math.max(a.size[0],a.size[1])||b.size[0]*b.size[1]-a.size[0]*a.size[1]);
  let free:Rect[]=[{x:margin,y:margin,w:bedSize[0]-2*margin+spacing,h:bedSize[1]-2*margin+spacing}];
  const result=new Map<string,PlateObject>();
  for(const {object,size} of items){
    const w=size[0]+spacing,h=size[1]+spacing;
    const fit=free.filter(r=>r.w+1e-6>=w&&r.h+1e-6>=h).sort((a,b)=>Math.min(a.w-w,a.h-h)-Math.min(b.w-w,b.h-h)||a.w*a.h-b.w*b.h)[0];
    if(!fit||size[2]>bedSize[2])throw new Error('These models do not fit on one plate with the current sizes, orientations, brim, and spacing. Scale or rotate them first.');
    const used={x:fit.x,y:fit.y,w,h};
    result.set(object.id,{...object,transform:{...object.transform,positionX:used.x+size[0]/2,positionY:used.y+size[1]/2,positionZ:0}});
    const split:Rect[]=[];
    for(const r of free){
      if(used.x>=r.x+r.w||used.x+used.w<=r.x||used.y>=r.y+r.h||used.y+used.h<=r.y){split.push(r);continue;}
      if(used.x>r.x)split.push({...r,w:used.x-r.x});
      if(used.x+used.w<r.x+r.w)split.push({...r,x:used.x+used.w,w:r.x+r.w-used.x-used.w});
      if(used.y>r.y)split.push({...r,h:used.y-r.y});
      if(used.y+used.h<r.y+r.h)split.push({...r,y:used.y+used.h,h:r.y+r.h-used.y-used.h});
    }
    free=split.filter((a,i)=>a.w>1e-6&&a.h>1e-6&&!split.some((b,j)=>j!==i&&a.x>=b.x-1e-6&&a.y>=b.y-1e-6&&a.x+a.w<=b.x+b.w+1e-6&&a.y+a.h<=b.y+b.h+1e-6&&(j<i||a.w*a.h<b.w*b.h-1e-6)));
  }
  const arranged=objects.map(object=>result.get(object.id)!),box=plateBounds(arranged);
  if(!box)return [];
  const dx=bedSize[0]/2-box.center[0],dy=bedSize[1]/2-box.center[1];
  return arranged.map(object=>({...object,transform:{...object.transform,positionX:object.transform.positionX+dx,positionY:object.transform.positionY+dy}}));
}

export type AutoOrientOptions=Pick<PlateOptions,'bedSize'|'brim'> & {onProgress?:(completed:number,total:number)=>void};
export type AutoOrientResult={transform:ObjectTransform;summary:{candidates:number;contactArea:number;overhangArea:number;height:number}};
type Facet={a:THREE.Vector3;b:THREE.Vector3;c:THREE.Vector3;normal:THREE.Vector3;area:number;weight:number};
/** Surface-based heuristic, not a strength/finish guarantee. Large meshes are sampled for scoring. */
export function autoOrient(model:Model,transform:ObjectTransform,options:AutoOrientOptions={}):AutoOrientResult {
  const t=checked(transform),s=scaling(t),p=model.geometry.getAttribute('position'),index=model.geometry.index,count=(index?.count??p.count)/3;
  if(!Number.isInteger(count)||count<1||count>MAX_TRIANGLES)throw new Error('Choose a triangular mesh with at most 1 million triangles.');
  const stride=Math.max(1,Math.ceil(count/16_000)),facets:Facet[]=[],groups=new Map<string,{area:number;facet:Facet}>();
  const flip=s.x*s.y*s.z<0;
  for(let i=0;i<count;i++){
    const vertex=(j:number)=>new THREE.Vector3().fromBufferAttribute(p,index?index.getX(i*3+j):i*3+j).multiply(s);
    const a=vertex(0),b=vertex(1),c=vertex(2),normal=new THREE.Vector3().subVectors(b,a).cross(new THREE.Vector3().subVectors(c,a));
    const area=normal.length()/2;if(!Number.isFinite(area))throw new Error('The model contains invalid coordinates.');if(area<1e-10)continue;
    normal.normalize();if(flip)normal.negate();
    const facet={a,b,c,normal,area,weight:1},key=normal.toArray().map(n=>Math.round(n*30)).join(',');
    const group=groups.get(key);
    if(group){group.area+=area;if(area>group.facet.area)group.facet=facet;}else groups.set(key,{area,facet});
    if(i%stride===0)facets.push({...facet,weight:Math.min(stride,count-i)});
  }
  if(!facets.length)throw new Error('No non-degenerate faces were found for orientation.');
  const planes=[...groups.values()].sort((a,b)=>b.area-a.area).slice(0,24);
  // Include large planar representatives even when the sample stride missed them.
  if(stride>1)for(const plane of planes)facets.push(plane.facet);
  const candidates:THREE.Quaternion[]=[],seen=new Set<string>();
  const add=(q:THREE.Quaternion)=>{q.normalize();if(q.w<0)q.set(-q.x,-q.y,-q.z,-q.w);const key=q.toArray().map(n=>Math.round(n*10000)).join(',');if(!seen.has(key)){seen.add(key);candidates.push(q);}};
  add(rotation(t));
  for(const plane of planes){
    const q=new THREE.Quaternion().setFromUnitVectors(plane.facet.normal,down);add(q.clone());
    // A triangle's longest edge may be a rectangular face's diagonal. Evaluate
    // every edge so rectangular parts can also align their sides to the bed.
    const edges=[plane.facet.b.clone().sub(plane.facet.a),plane.facet.c.clone().sub(plane.facet.b),plane.facet.a.clone().sub(plane.facet.c)];
    for(const edge of edges){edge.applyQuaternion(q);const yaw=-Math.atan2(edge.y,edge.x);add(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0,0,1),yaw).multiply(q));}
  }
  for(const normal of [new THREE.Vector3(1,0,0),new THREE.Vector3(-1,0,0),new THREE.Vector3(0,1,0),new THREE.Vector3(0,-1,0),new THREE.Vector3(0,0,1),down])add(new THREE.Quaternion().setFromUnitVectors(normal,down));
  const scored:{q:THREE.Quaternion;score:number;contactArea:number;overhangArea:number}[]=[];
  const a=new THREE.Vector3(),b=new THREE.Vector3(),c=new THREE.Vector3(),normal=new THREE.Vector3();
  candidates.forEach((q,candidate)=>{
    const box=new THREE.Box3();let totalArea=0;
    for(const f of facets){box.expandByPoint(a.copy(f.a).applyQuaternion(q));box.expandByPoint(b.copy(f.b).applyQuaternion(q));box.expandByPoint(c.copy(f.c).applyQuaternion(q));totalArea+=f.area*f.weight;}
    const size=box.getSize(new THREE.Vector3()),diagonal=Math.max(size.length(),0.001),tolerance=Math.max(0.02,size.z*0.00001);
    let contactArea=0,overhangArea=0,supportVolume=0;
    for(const f of facets){
      a.copy(f.a).applyQuaternion(q);b.copy(f.b).applyQuaternion(q);c.copy(f.c).applyQuaternion(q);normal.copy(f.normal).applyQuaternion(q);
      const area=f.area*f.weight,maxZ=Math.max(a.z,b.z,c.z),onBed=maxZ-box.min.z<=tolerance;
      if(onBed&&normal.z<-.5)contactArea+=area;
      if(!onBed&&normal.z<-Math.SQRT1_2){const support=area*(-normal.z-Math.SQRT1_2)/(1-Math.SQRT1_2);overhangArea+=support;supportVolume+=support*((a.z+b.z+c.z)/3-box.min.z);}
    }
    const score=100*overhangArea/totalArea+50*supportVolume/(totalArea*diagonal)-20*contactArea/totalArea+2*size.z/diagonal+0.5*size.x*size.y/totalArea+(contactArea>0?0:20);
    scored.push({q,score,contactArea,overhangArea});options.onProgress?.(candidate+1,candidates.length);
  });
  scored.sort((a,b)=>a.score-b.score);
  const {bedSize,margin}=plateOptions(options);
  for(const candidate of scored){
    const result={...rotationResult(t,candidate.q),positionZ:0},bounds=objectBounds(model,result);
    if(bounds.min[0]<margin-0.001||bounds.min[1]<margin-0.001||bounds.max[0]>bedSize[0]-margin+0.001||bounds.max[1]>bedSize[1]-margin+0.001||bounds.max[2]>bedSize[2]+0.001)continue;
    return {transform:result,summary:{candidates:candidates.length,contactArea:candidate.contactArea,overhangArea:candidate.overhangArea,height:bounds.size[2]}};
  }
  throw new Error('No evaluated orientation fits here. Center or scale the model, then try Auto orient again.');
}
