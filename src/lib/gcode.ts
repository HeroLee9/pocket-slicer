export type GcodePreview = {positions:Float32Array;colors:Float32Array;layers:{z:number;end:number}[];time:string;filamentGrams:string;filamentMeters:string;segments:number;truncated:boolean};
/** Support extrusion centers and dimensions for an overall model/support view. */
export type SupportPreview = {positions:Float32Array;colors:Float32Array;widths:Float32Array;heights:Float32Array;segments:number;totalSegments:number;truncated:boolean};
export const MAX_PREVIEW_SEGMENTS=200_000;
export const MAX_SUPPORT_PREVIEW_SEGMENTS=50_000;
export const MAX_PREVIEW_LAYERS=10_000;
export const MAX_PREVIEW_LINE_LENGTH=4096;
const PALETTE:Record<string,number[]> = {'outer wall':[0.14,0.42,0.98],'inner wall':[0.22,0.58,0.96],'sparse infill':[0.96,0.62,0.17],'internal solid infill':[0.51,0.39,0.90],'top surface':[0.21,0.69,0.71],'support':[0.24,0.73,0.47],'support interface':[0.29,0.81,0.57],'skirt':[0.42,0.50,0.61],'brim':[0.42,0.50,0.61]};
for(const key of Object.keys(PALETTE))PALETTE[key]=PALETTE[key].map(c=>c<=0.04045?c/12.92:((c+0.055)/1.055)**2.4);

type Input=string|Uint8Array;
type Arc={cx:number;cy:number;r:number;a0:number;da:number};
type Motion={x:number;y:number;z:number;nx:number;ny:number;nz:number;count:number;color:number[];role:string;width:number;height:number;arc?:Arc};
const SUPPORT_ROLES=new Set(['support','support material','support interface','support material interface','support transition','support material transition']);

// Decode one bounded line at a time. In particular, never decode a whole G-code
// byte buffer or split it into an array of strings in the preview worker.
function eachLine(input:Input,visit:(line:string)=>void):boolean {
  const decoder=typeof input==='string'?null:new TextDecoder();
  let limited=false;
  for(let start=0;start<input.length;){
    let end=typeof input==='string'?input.indexOf('\n',start):input.indexOf(10,start);
    if(end<0)end=input.length;
    if(end-start<=MAX_PREVIEW_LINE_LENGTH){
      const line=typeof input==='string'?input.slice(start,end):decoder!.decode(input.subarray(start,end));
      visit(line.trim());
    }else limited=true;
    start=end+1;
  }
  return limited;
}

function scan(input:Input,visit:(motion:Motion)=>void,comment?:(line:string)=>void):boolean {
  let x=0,y=0,z=0,e=0,relativeE=true,relativeXYZ=false,color=PALETTE['outer wall'],role='outer wall',width=.45,height=.2,invalid=false;
  const limited=eachLine(input,line=>{
    if(line.startsWith(';')){
      const type=line.match(/^;\s*(?:TYPE|FEATURE):\s*(.+)/i);
      if(type){role=type[1].trim().toLowerCase();color=PALETTE[role]||(SUPPORT_ROLES.has(role)?PALETTE[role.includes('interface')?'support interface':'support']:PALETTE['outer wall']);}
      const dimension=line.match(/^;\s*(WIDTH|HEIGHT):\s*([\d.]+)\s*$/i);
      if(dimension){const value=Number(dimension[2]);if(Number.isFinite(value)&&value>0&&value<=10){if(dimension[1].toUpperCase()==='WIDTH')width=value;else height=value;}else invalid=true;}
      comment?.(line);return;
    }
    const semicolon=line.indexOf(';'),command=semicolon<0?line:line.slice(0,semicolon);
    const opcode=command.match(/^([GM]\d+)\b/)?.[1];
    if(opcode==='M82'){relativeE=false;return;}if(opcode==='M83'){relativeE=true;return;}
    if(opcode==='G90'){relativeXYZ=false;return;}if(opcode==='G91'){relativeXYZ=true;return;}
    if(!['G0','G1','G2','G3','G92'].includes(opcode||''))return;
    const p:Record<string,number>={};
    for(const match of command.matchAll(/([XYZEIFJ])\s*([+-]?(?:\d+\.?\d*|\.\d+))/g)){
      const value=Number(match[2]);
      if(!Number.isFinite(value)||Math.abs(value)>1e9){invalid=true;return;}
      p[match[1]]=value;
    }
    if(opcode==='G92'){if(p.E!==undefined)e=p.E;if(p.X!==undefined)x=p.X;if(p.Y!==undefined)y=p.Y;if(p.Z!==undefined)z=p.Z;return;}
    const nx=p.X===undefined?x:p.X+(relativeXYZ?x:0),ny=p.Y===undefined?y:p.Y+(relativeXYZ?y:0),nz=p.Z===undefined?z:p.Z+(relativeXYZ?z:0);
    const de=p.E===undefined?0:relativeE?p.E:p.E-e;
    if(!Number.isFinite(nx+ny+nz)||Math.max(Math.abs(nx),Math.abs(ny),Math.abs(nz))>1e9){invalid=true;return;}
    const isArc=(opcode==='G2'||opcode==='G3')&&(p.I!==undefined||p.J!==undefined);
    if(de>0&&(nx!==x||ny!==y||isArc)&&nz>=0&&nz<=251){
      if(isArc){
        const cx=x+(p.I||0),cy=y+(p.J||0),r=Math.hypot(x-cx,y-cy),a0=Math.atan2(y-cy,x-cx),a1=Math.atan2(ny-cy,nx-cx);
        let da=a1-a0;if(opcode==='G2'&&da>=0)da-=2*Math.PI;if(opcode==='G3'&&da<=0)da+=2*Math.PI;
        visit({x,y,z,nx,ny,nz,color,role,width,height,count:Math.min(200,Math.max(4,Math.ceil(Math.abs(da)*r))),arc:{cx,cy,r,a0,da}});
      }else visit({x,y,z,nx,ny,nz,color,role,width,height,count:1});
    }
    x=nx;y=ny;z=nz;if(p.E!==undefined)e=relativeE?e+p.E:p.E;
  });
  return limited||invalid;
}

function parsePreview(input:Input,supportsOnly:boolean) {
  let total=0,time='—',filamentGrams='—',filamentMeters='—';
  const selected=(motion:Motion)=>!supportsOnly||SUPPORT_ROLES.has(motion.role);
  const limited=scan(input,motion=>{if(selected(motion))total+=motion.count;},line=>{
    const t=line.match(/estimated printing time \(normal mode\)\s*=\s*(.+)/i);if(t)time=t[1].slice(0,512);
    const g=line.match(/(?:total )?filament used \[g\]\s*=\s*([\d.]+)/i);if(g&&Number.isFinite(Number(g[1])))filamentGrams=Number(g[1]).toFixed(1);
    const m=line.match(/(?:total )?filament used \[mm\]\s*=\s*([\d.]+)/i);if(m&&Number.isFinite(Number(m[1])))filamentMeters=(Number(m[1])/1000).toFixed(2);
  });
  const segments=Math.min(total,supportsOnly?MAX_SUPPORT_PREVIEW_SEGMENTS:MAX_PREVIEW_SEGMENTS),positions=new Float32Array(segments*6),colors=new Float32Array(segments*6),layers:GcodePreview['layers']=[];
  const widths=new Float32Array(supportsOnly?segments:0),heights=new Float32Array(supportsOnly?segments:0);
  let seen=0,written=0,next=0,lastPrintZ:number|undefined,truncated=limited||total>segments;
  if(segments)scan(input,motion=>{
    if(!selected(motion))return;
    const {x,y,z,nx,ny,nz,count,color,arc}=motion;
    while(written<segments&&next<seen+count){
      const step=next-seen+1,offset=written*6;
      let ax=x,ay=y,az=z,bx=nx,by=ny,bz=nz;
      if(arc){
        if(step>1){const angle=arc.a0+arc.da*(step-1)/count;ax=arc.cx+arc.r*Math.cos(angle);ay=arc.cy+arc.r*Math.sin(angle);az=z+(nz-z)*(step-1)/count;}
        if(step<count){const angle=arc.a0+arc.da*step/count;bx=arc.cx+arc.r*Math.cos(angle);by=arc.cy+arc.r*Math.sin(angle);bz=z+(nz-z)*step/count;}
      }
      positions[offset]=ax;positions[offset+1]=ay;positions[offset+2]=az;positions[offset+3]=bx;positions[offset+4]=by;positions[offset+5]=bz;
      for(let channel=0;channel<3;channel++)colors[offset+channel]=colors[offset+channel+3]=color[channel];
      if(supportsOnly){widths[written]=motion.width;heights[written]=motion.height;}
      if(!supportsOnly&&(lastPrintZ===undefined||Math.abs(bz-lastPrintZ)>0.001)){
        if(layers.length)layers[layers.length-1].end=written*2;
        if(layers.length<MAX_PREVIEW_LAYERS)layers.push({z:bz,end:written*2});
        else{layers[layers.length-1].z=bz;truncated=true;}
        lastPrintZ=bz;
      }
      written++;
      // Spread retained segments across the complete file, retaining both ends.
      // Omitted moves stay separate: no artificial lines connect sampled paths.
      next=segments===1?total:Math.round(written*(total-1)/(segments-1));
    }
    seen+=count;
  });
  if(layers.length)layers[layers.length-1].end=segments*2;
  return {positions,colors,layers,time,filamentGrams,filamentMeters,segments,totalSegments:total,truncated,widths,heights};
}

export function parseGcode(input:Input):GcodePreview {
  const {positions,colors,layers,time,filamentGrams,filamentMeters,segments,truncated}=parsePreview(input,false);
  return {positions,colors,layers,time,filamentGrams,filamentMeters,segments,truncated};
}

/** Scan every move to maintain coordinates, but retain only tagged supports.
 * The model remains the imported solid mesh; walls, infill and travel moves
 * never allocate preview geometry here. Sampling covers the entire support. */
export function parseSupportPreview(input:Input):SupportPreview {
  const {positions,colors,widths,heights,segments,totalSegments,truncated}=parsePreview(input,true);
  return {positions,colors,widths,heights,segments,totalSegments,truncated};
}
