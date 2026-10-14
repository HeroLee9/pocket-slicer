import {BufferAttribute,BufferGeometry} from 'three';
import type {SupportPreview} from './gcode';

// Extrusion-sized prisms show the overall support shape without building the
// model's toolpaths. Eight shared vertices per segment keep GPU memory bounded.
export function supportGeometry(preview:SupportPreview):BufferGeometry {
  const positions=new Float32Array(preview.segments*24);
  const indices=new Uint32Array(preview.segments*36);
  const faces=[0,2,1,0,3,2,4,5,6,4,6,7,0,1,5,0,5,4,1,2,6,1,6,5,2,3,7,2,7,6,3,0,4,3,4,7];
  for(let segment=0;segment<preview.segments;segment++){
    const i=segment*6,ax=preview.positions[i],ay=preview.positions[i+1],az=preview.positions[i+2];
    const bx=preview.positions[i+3],by=preview.positions[i+4],bz=preview.positions[i+5];
    const length=Math.hypot(bx-ax,by-ay)||1,half=preview.widths[segment]/2;
    const dx=-(by-ay)/length*half,dy=(bx-ax)/length*half,height=preview.heights[segment];
    // G-code Z is the top of the deposited extrusion, not its center.
    positions.set([ax+dx,ay+dy,Math.max(0,az-height),ax-dx,ay-dy,Math.max(0,az-height),bx-dx,by-dy,Math.max(0,bz-height),bx+dx,by+dy,Math.max(0,bz-height),ax+dx,ay+dy,az,ax-dx,ay-dy,az,bx-dx,by-dy,bz,bx+dx,by+dy,bz],segment*24);
    for(let face=0;face<faces.length;face++)indices[segment*36+face]=segment*8+faces[face];
  }
  const geometry=new BufferGeometry();geometry.setAttribute('position',new BufferAttribute(positions,3));geometry.setIndex(new BufferAttribute(indices,1));geometry.computeVertexNormals();return geometry;
}
