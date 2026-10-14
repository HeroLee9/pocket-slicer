import * as THREE from 'three';
import {autoOrient,type AutoOrientOptions,type ObjectTransform} from './geometry';
self.onmessage=({data}:{data:{positions:Float32Array;transform:ObjectTransform;options?:AutoOrientOptions}})=>{
  const geometry=new THREE.BufferGeometry();
  try{
    geometry.setAttribute('position',new THREE.BufferAttribute(data.positions,3));
    const result=autoOrient({name:'model',geometry,triangles:data.positions.length/9},data.transform,{...data.options,onProgress:(completed,total)=>self.postMessage({type:'progress',completed,total})});
    self.postMessage({type:'result',result});
  }catch(error){self.postMessage({type:'error',error:error instanceof Error?error.message:String(error)});}
  finally{geometry.dispose();}
};
