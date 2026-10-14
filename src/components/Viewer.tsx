import {useEffect,useRef,useState} from 'react';
import * as THREE from 'three';
import {OrbitControls} from 'three/examples/jsm/controls/OrbitControls.js';
import {Box,Home,Minus,Plus} from 'lucide-react';
import {placedGeometry,type ObjectTransform,type PlateObject} from '../lib/geometry';
import type {GcodePreview} from '../lib/gcode';
import type {ViewMode} from './ModelTools';

type Props={objects:PlateObject[];selectedId:string|null;onSelect:(id:string)=>void;onMove:(id:string,patch:Partial<ObjectTransform>)=>void;onFace:(id:string,index:number)=>void;mode:ViewMode;onMode:(mode:ViewMode)=>void;disabled:boolean;preview:GcodePreview|null;layer:number;showPreview:boolean;dimensions:number[]|null};
type Context={renderer:THREE.WebGLRenderer;scene:THREE.Scene;camera:THREE.PerspectiveCamera;controls:OrbitControls;group:THREE.Group;render:()=>void;reset:()=>void};
function clearGroup(group:THREE.Group){for(const object of [...group.children]){group.remove(object);if(object instanceof THREE.Mesh||object instanceof THREE.LineSegments){object.geometry.dispose();(Array.isArray(object.material)?object.material:[object.material]).forEach(m=>m.dispose());}}}
export default function Viewer(props:Props){
  const {objects,selectedId,mode,disabled,preview,layer,showPreview,dimensions}=props;
  const mount=useRef<HTMLDivElement>(null),context=useRef<Context|null>(null),latest=useRef(props);latest.current=props;
  const [failure,setFailure]=useState('');
  useEffect(()=>{
    const el=mount.current!;let renderer:THREE.WebGLRenderer;
    try{renderer=new THREE.WebGLRenderer({antialias:true,alpha:false,powerPreference:'low-power'});}catch{setFailure('3D preview is unavailable in this browser. You can still import and slice a model.');return;}
    renderer.setPixelRatio(Math.min(window.devicePixelRatio,2));renderer.setClearColor(0xedf1f5);el.appendChild(renderer.domElement);
    const scene=new THREE.Scene();scene.background=new THREE.Color(0xedf1f5);
    const camera=new THREE.PerspectiveCamera(36,1,0.1,2000);camera.up.set(0,0,1);
    const controls=new OrbitControls(camera,renderer.domElement);controls.enableDamping=false;controls.minDistance=20;controls.maxDistance=850;controls.maxPolarAngle=Math.PI*.75;controls.target.set(110,110,5);
    const group=new THREE.Group();scene.add(group);
    const render=()=>renderer.render(scene,camera);
    const reset=()=>{camera.position.set(285,-160,260);controls.target.set(110,110,10);controls.update();render();};
    const grid=new THREE.GridHelper(220,22,0xbac4d0,0xd0d8e1);grid.rotation.x=Math.PI/2;grid.position.set(110,110,-.3);scene.add(grid);
    const plate=new THREE.Mesh(new THREE.PlaneGeometry(220,220),new THREE.MeshStandardMaterial({color:0xe0e6ed,roughness:1,side:THREE.DoubleSide}));plate.position.set(110,110,-.5);scene.add(plate);
    scene.add(new THREE.HemisphereLight(0xffffff,0x7e8ca8,2.5));const light=new THREE.DirectionalLight(0xffffff,2.6);light.position.set(-70,-110,250);scene.add(light);
    const resize=()=>{const w=el.clientWidth,h=el.clientHeight;renderer.setSize(w,h,false);camera.aspect=w/h;camera.updateProjectionMatrix();render();};
    controls.addEventListener('change',render);const observer=new ResizeObserver(resize);observer.observe(el);
    context.current={renderer,scene,camera,controls,group,render,reset};reset();resize();
    const ray=new THREE.Raycaster(),point=new THREE.Vector2(),floor=new THREE.Plane(new THREE.Vector3(0,0,1),0);
    const setRay=(e:PointerEvent)=>{const r=renderer.domElement.getBoundingClientRect();point.set((e.clientX-r.left)/r.width*2-1,-(e.clientY-r.top)/r.height*2+1);ray.setFromCamera(point,camera);};
    let drag:{id:string;mesh:THREE.Object3D;start:THREE.Vector3;oldX:number;oldY:number;dx:number;dy:number}|null=null;
    let down:{x:number;y:number;pointerId:number}|null=null;
    const onDown=(e:PointerEvent)=>{const p=latest.current;if(p.disabled||p.showPreview)return;down={x:e.clientX,y:e.clientY,pointerId:e.pointerId};if(p.mode==='move'){setRay(e);const hit=ray.intersectObjects(group.children)[0];if(hit){const start=ray.ray.intersectPlane(floor,new THREE.Vector3());const obj=p.objects.find(o=>o.id===hit.object.userData.id);if(start&&obj){drag={id:obj.id,mesh:hit.object,start,oldX:obj.transform.positionX,oldY:obj.transform.positionY,dx:0,dy:0};renderer.domElement.setPointerCapture(e.pointerId);}}}};
    const onMove=(e:PointerEvent)=>{if(!drag||e.pointerId!==down?.pointerId)return;setRay(e);const hit=ray.ray.intersectPlane(floor,new THREE.Vector3());if(!hit)return;drag.dx=hit.x-drag.start.x;drag.dy=hit.y-drag.start.y;drag.mesh.position.set(drag.dx,drag.dy,0);render();};
    const onUp=(e:PointerEvent)=>{if(!down||e.pointerId!==down.pointerId)return;const p=latest.current;const moved=Math.hypot(e.clientX-down.x,e.clientY-down.y);down=null;if(drag){const d=drag;drag=null;p.onSelect(d.id);if(moved>2)p.onMove(d.id,{positionX:Math.round((d.oldX+d.dx)*10)/10,positionY:Math.round((d.oldY+d.dy)*10)/10});else{d.mesh.position.set(0,0,0);render();}return;}if(moved>6||p.disabled||p.showPreview)return;setRay(e);const hit=ray.intersectObjects(group.children)[0];if(hit){p.onSelect(hit.object.userData.id);if(p.mode==='face'&&hit.faceIndex!=null)p.onFace(hit.object.userData.id,hit.faceIndex);}};
    const onCancel=()=>{if(drag){drag.mesh.position.set(0,0,0);render();}drag=null;down=null;};
    const canvas=renderer.domElement;canvas.addEventListener('pointerdown',onDown);canvas.addEventListener('pointermove',onMove);canvas.addEventListener('pointerup',onUp);canvas.addEventListener('pointercancel',onCancel);
    const lost=(e:Event)=>{e.preventDefault();setFailure('The 3D view was interrupted. Save your G-code, then reload to restore it.');};canvas.addEventListener('webglcontextlost',lost);
    return()=>{observer.disconnect();controls.dispose();scene.traverse(o=>{if(o instanceof THREE.Mesh||o instanceof THREE.LineSegments){o.geometry.dispose();(Array.isArray(o.material)?o.material:[o.material]).forEach(v=>v.dispose());}});canvas.removeEventListener('pointerdown',onDown);canvas.removeEventListener('pointermove',onMove);canvas.removeEventListener('pointerup',onUp);canvas.removeEventListener('pointercancel',onCancel);renderer.dispose();canvas.remove();context.current=null;};
  },[]);
  useEffect(()=>{const c=context.current;if(c)c.controls.enabled=mode==='orbit'||showPreview;},[mode,showPreview]);
  useEffect(()=>{const c=context.current;if(!c)return;clearGroup(c.group);
    if(showPreview&&preview){const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.BufferAttribute(preview.positions,3));g.setAttribute('color',new THREE.BufferAttribute(preview.colors,3));c.group.add(new THREE.LineSegments(g,new THREE.LineBasicMaterial({vertexColors:true})));}
    else for(const object of objects){try{const mesh=new THREE.Mesh(placedGeometry(object.model,object.transform),new THREE.MeshStandardMaterial({color:object.id===selectedId?0x246bfd:0x8195b8,roughness:.6,metalness:.03,flatShading:true}));mesh.userData.id=object.id;c.group.add(mesh);}catch{/* Invalid numeric drafts are explained in the controls. */}}
    c.render();
  },[objects,selectedId,preview,showPreview]);
  useEffect(()=>{const c=context.current;if(c&&showPreview&&preview){for(const object of c.group.children)if(object instanceof THREE.LineSegments)object.geometry.setDrawRange(0,preview.layers[Math.max(0,layer-1)]?.end||0);c.render();}},[layer,preview,showPreview]);
  const zoom=(factor:number)=>{const c=context.current;if(!c)return;c.camera.position.sub(c.controls.target).multiplyScalar(factor).add(c.controls.target);c.controls.update();c.render();};
  const top=()=>{const c=context.current;if(!c)return;c.camera.position.set(110,109.99,390);c.controls.target.set(110,110,0);c.controls.update();c.render();};
  return <div className="viewport"><div className="three-mount" ref={mount}/>{objects.length>0&&!showPreview&&<div className="view-mode-tools">{(['orbit','move','face'] as const).map(m=><button key={m} disabled={disabled} aria-pressed={mode===m} onClick={()=>props.onMode(m)}>{m==='face'?'Lay on face':m==='move'?'Move':'Orbit'}</button>)}</div>}<div className="view-tools"><button aria-label="Reset view" onClick={()=>context.current?.reset()}><Home size={20}/></button><button aria-label="Zoom in" onClick={()=>zoom(.8)}><Plus size={20}/></button><button aria-label="Zoom out" onClick={()=>zoom(1.25)}><Minus size={20}/></button><button aria-label="Top view" onClick={top}><Box size={20}/></button></div>{!objects.length&&!failure&&<div className="viewport-empty"><Box size={35} strokeWidth={1.3}/><strong>Your next print starts here</strong><span>Import a model to place it on the bed.</span></div>}{failure&&<div className="viewport-empty">{failure}</div>}{objects.length>0&&mode!=='orbit'&&!showPreview&&<span className="view-instruction">{mode==='face'?'Tap a flat face to place it against the bed.':'Drag a model to move it across the bed.'}</span>}<span className="bed-label">K1C · 220 × 220 mm</span>{dimensions&&<span className="dimensions">{dimensions.map(v=>v.toFixed(1).replace('.0','')).join(' × ')} mm</span>}</div>;
}
