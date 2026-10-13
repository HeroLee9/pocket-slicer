export type GcodePreview = {positions:Float32Array;colors:Float32Array;layers:{z:number;end:number}[];time:string;filamentGrams:string;filamentMeters:string;segments:number;truncated:boolean};
const PALETTE:Record<string,number[]> = {'outer wall':[0.14,0.42,0.98],'inner wall':[0.22,0.58,0.96],'sparse infill':[0.96,0.62,0.17],'internal solid infill':[0.51,0.39,0.90],'top surface':[0.21,0.69,0.71],'support':[0.24,0.73,0.47],'support interface':[0.29,0.81,0.57],'skirt':[0.42,0.50,0.61],'brim':[0.42,0.50,0.61]};
for (const key of Object.keys(PALETTE)) PALETTE[key]=PALETTE[key].map(c=>c<=0.04045?c/12.92:((c+0.055)/1.055)**2.4);
export function parseGcode(text:string):GcodePreview {
  const positions:number[]=[],colors:number[]=[],layers:{z:number;end:number}[]=[];
  let x=0,y=0,z=0,e=0,relativeE=true,relativeXYZ=false,color=PALETTE['outer wall'],lastPrintZ:number|undefined,segments=0,truncated=false;
  const MAX_SEGMENTS=750_000;
  const add=(ax:number,ay:number,az:number,bx:number,by:number,bz:number)=>{
    if (segments>=MAX_SEGMENTS) {truncated=true;return;}
    if (lastPrintZ===undefined || Math.abs(bz-lastPrintZ)>0.001) {if(layers.length)layers[layers.length-1].end=segments*2;layers.push({z:bz,end:segments*2});lastPrintZ=bz;}
    positions.push(ax,ay,az,bx,by,bz);colors.push(...color,...color);segments++;
  };
  let time='—',filamentGrams='—',filamentMeters='—';
  // Iterate by offsets to avoid retaining an array of every line in a large file.
  for(let start=0;start<text.length;) {
    let end=text.indexOf('\n',start);if(end<0)end=text.length;
    const line=text.slice(start,end).trim();start=end+1;
    if(line.startsWith(';')) {
      const type=line.match(/^;\s*(?:TYPE|FEATURE):\s*(.+)/i);if(type)color=PALETTE[type[1].toLowerCase()]||PALETTE['outer wall'];
      const t=line.match(/estimated printing time \(normal mode\)\s*=\s*(.+)/i);if(t)time=t[1];
      const g=line.match(/(?:total )?filament used \[g\]\s*=\s*([\d.]+)/i);if(g)filamentGrams=Number(g[1]).toFixed(1);
      const m=line.match(/(?:total )?filament used \[mm\]\s*=\s*([\d.]+)/i);if(m)filamentMeters=(Number(m[1])/1000).toFixed(2);
      continue;
    }
    const command=line.split(';')[0].trim();
    const opcode=command.match(/^([GM]\d+)\b/)?.[1];
    if(opcode==='M82'){relativeE=false;continue;}if(opcode==='M83'){relativeE=true;continue;}
    if(opcode==='G90'){relativeXYZ=false;continue;}if(opcode==='G91'){relativeXYZ=true;continue;}
    if(!['G0','G1','G2','G3','G92'].includes(opcode||''))continue;
    const p:Record<string,number>={};for(const m of command.matchAll(/([XYZEIFJ])\s*(-?(?:\d+\.?\d*|\.\d+))/g))p[m[1]]=Number(m[2]);
    if(opcode==='G92'){if(p.E!==undefined)e=p.E;if(p.X!==undefined)x=p.X;if(p.Y!==undefined)y=p.Y;if(p.Z!==undefined)z=p.Z;continue;}
    const nx=p.X===undefined?x:p.X+(relativeXYZ?x:0),ny=p.Y===undefined?y:p.Y+(relativeXYZ?y:0),nz=p.Z===undefined?z:p.Z+(relativeXYZ?z:0);
    const de=p.E===undefined?0:relativeE?p.E:p.E-e;
    if(de>0 && (nx!==x||ny!==y) && nz>=0 && nz<=251) {
      if((opcode==='G2'||opcode==='G3')&&(p.I!==undefined||p.J!==undefined)) {
        const cx=x+(p.I||0),cy=y+(p.J||0),r=Math.hypot(x-cx,y-cy),a0=Math.atan2(y-cy,x-cx),a1=Math.atan2(ny-cy,nx-cx);
        let da=a1-a0;if(opcode==='G2'&&da>=0)da-=2*Math.PI;if(opcode==='G3'&&da<=0)da+=2*Math.PI;
        const n=Math.min(200,Math.max(4,Math.ceil(Math.abs(da)*r/1)));let px=x,py=y,pz=z;
        for(let j=1;j<=n;j++){const a=a0+da*j/n,qx=j===n?nx:cx+r*Math.cos(a),qy=j===n?ny:cy+r*Math.sin(a),qz=z+(nz-z)*j/n;add(px,py,pz,qx,qy,qz);px=qx;py=qy;pz=qz;}
      }else add(x,y,z,nx,ny,nz);
    }
    x=nx;y=ny;z=nz;if(p.E!==undefined)e=relativeE?e+p.E:p.E;
  }
  if(layers.length)layers[layers.length-1].end=segments*2;
  return {positions:new Float32Array(positions),colors:new Float32Array(colors),layers,time,filamentGrams,filamentMeters,segments,truncated};
}
