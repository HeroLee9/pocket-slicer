import {useEffect,useRef,useState} from 'react';
import * as THREE from 'three';
import {OrbitControls} from 'three/examples/jsm/controls/OrbitControls.js';
import {Box,Home,Minus,Plus} from 'lucide-react';
import {transformedGeometry,type Model,type Transform} from '../lib/model';
import type {GcodePreview} from '../lib/gcode';

type Props={model:Model|null;transform:Transform;preview:GcodePreview|null;layer:number;showPreview:boolean;dimensions:number[]|null};
export default function Viewer({model,transform,preview,layer,showPreview,dimensions}:Props){
  const mount=useRef<HTMLDivElement>(null);
  const context=useRef<{renderer:THREE.WebGLRenderer;scene:THREE.Scene;camera:THREE.PerspectiveCamera;controls:OrbitControls;object:THREE.Mesh|THREE.LineSegments|null;render:()=>void;reset:()=>void}|null>(null);
  const [failure,setFailure]=useState('');
  useEffect(()=>{
    const el=mount.current!;let renderer:THREE.WebGLRenderer;
    try{renderer=new THREE.WebGLRenderer({antialias:true,alpha:false,powerPreference:'low-power'});}catch{setFailure('3D preview is unavailable in this browser. You can still import and slice a model.');return;}
    renderer.setPixelRatio(Math.min(window.devicePixelRatio,2));
    renderer.setClearColor(0xedf1f5);
    el.appendChild(renderer.domElement);
    const scene=new THREE.Scene();scene.background=new THREE.Color(0xedf1f5);
    const camera=new THREE.PerspectiveCamera(36,1,0.1,2000);camera.up.set(0,0,1);
    const controls=new OrbitControls(camera,renderer.domElement);controls.enableDamping=false;controls.minDistance=20;controls.maxDistance=850;controls.maxPolarAngle=Math.PI*0.49;controls.target.set(110,110,5);
    const render=()=>renderer.render(scene,camera);
    const reset=()=>{const object=context.current?.object;const box=object?new THREE.Box3().setFromObject(object):null;const size=box?.getSize(new THREE.Vector3());const d=size?Math.max(45,size.x,size.y,size.z)*2.2:280;const z=size?Math.min(100,size.z/2):10;camera.position.set(110+d*.65,110-d,Math.max(75,z+d*.8));controls.target.set(110,110,z);controls.update();render();};
    const grid=new THREE.GridHelper(220,22,0xbac4d0,0xd0d8e1);grid.rotation.x=Math.PI/2;grid.position.set(110,110,-0.3);scene.add(grid);
    const plate=new THREE.Mesh(new THREE.PlaneGeometry(220,220),new THREE.MeshStandardMaterial({color:0xe0e6ed,roughness:1}));plate.position.set(110,110,-0.5);scene.add(plate);
    scene.add(new THREE.HemisphereLight(0xffffff,0x7e8ca8,2.5));
    const light=new THREE.DirectionalLight(0xffffff,2.6);light.position.set(-70,-110,250);scene.add(light);
    const resize=()=>{const w=el.clientWidth,h=el.clientHeight;renderer.setSize(w,h,false);camera.aspect=w/h;camera.updateProjectionMatrix();render();};
    controls.addEventListener('change',render);
    const observer=new ResizeObserver(resize);observer.observe(el);
    context.current={renderer,scene,camera,controls,object:null,render,reset};reset();resize();
    const lost=(event:Event)=>{event.preventDefault();setFailure('The 3D view was interrupted. Reload to restore it; save your G-code first if a slice is ready.');};renderer.domElement.addEventListener('webglcontextlost',lost);
    return()=>{observer.disconnect();controls.dispose();scene.traverse(o=>{if(o instanceof THREE.Mesh||o instanceof THREE.LineSegments){o.geometry.dispose();const m=o.material;(Array.isArray(m)?m:[m]).forEach(v=>v.dispose());}});renderer.dispose();renderer.domElement.remove();context.current=null;};
  },[]);
  useEffect(()=>{
    const c=context.current;if(!c)return;
    if(c.object){c.scene.remove(c.object);c.object.geometry.dispose();(c.object.material as THREE.Material).dispose();c.object=null;}
    if(showPreview&&preview){const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.BufferAttribute(preview.positions,3));g.setAttribute('color',new THREE.BufferAttribute(preview.colors,3));c.object=new THREE.LineSegments(g,new THREE.LineBasicMaterial({vertexColors:true}));}
    else if(model&&[transform.scale,transform.x,transform.y,transform.z].every(Number.isFinite)&&transform.scale>0){c.object=new THREE.Mesh(transformedGeometry(model,transform),new THREE.MeshStandardMaterial({color:0x246bfd,roughness:0.6,metalness:0.03,flatShading:true}));}
    if(c.object)c.scene.add(c.object);c.render();
  },[model,transform,preview,showPreview]);
  useEffect(()=>{context.current?.reset();},[model]);
  useEffect(()=>{const c=context.current;if(c&&c.object instanceof THREE.LineSegments&&preview){c.object.geometry.setDrawRange(0,preview.layers[Math.max(0,layer-1)]?.end||0);c.render();}},[layer,preview,showPreview]);
  const zoom=(factor:number)=>{const c=context.current;if(!c)return;c.camera.position.sub(c.controls.target).multiplyScalar(factor).add(c.controls.target);c.controls.update();c.render();};
  const top=()=>{const c=context.current;if(!c)return;c.camera.position.set(110,109.99,370);c.controls.target.set(110,110,0);c.controls.update();c.render();};
  return <div className="viewport"><div className="three-mount" ref={mount}/><div className="view-tools"><button aria-label="Reset view" onClick={()=>context.current?.reset()}><Home size={20}/></button><button aria-label="Zoom in" onClick={()=>zoom(0.8)}><Plus size={20}/></button><button aria-label="Zoom out" onClick={()=>zoom(1.25)}><Minus size={20}/></button><button aria-label="Top view" onClick={top}><Box size={20}/></button></div>{!model&&!failure&&<div className="viewport-empty"><Box size={35} strokeWidth={1.3}/><strong>Your next print starts here</strong><span>Import a model to place it on the bed.</span></div>}{failure&&<div className="viewport-empty">{failure}</div>}<span className="bed-label">K1C · 220 × 220 mm</span>{dimensions&&<span className="dimensions">{dimensions.map(v=>v.toFixed(1).replace('.0','')).join(' × ')} mm</span>}</div>;
}
