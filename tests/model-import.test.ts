import { describe, expect, it } from 'vitest';
import { cubeModel, DEFAULT_TRANSFORM, modelDimensions, modelSTL, readModel } from '../src/lib/model';

function binaryCube() {
  const cube=cubeModel();
  try {return modelSTL(cube,DEFAULT_TRANSFORM);}
  finally {cube.geometry.dispose();}
}

describe('STL import',()=>{
  it('imports complete binary geometry even with an ambiguous solid header',async()=>{
    const bytes=binaryCube();
    new Uint8Array(bytes).set(new TextEncoder().encode('solid binary exporter'));
    const model=await readModel(new File([bytes],'cube.STL',{type:'application/octet-stream'}));
    try {
      expect(model.triangles).toBe(12);
      expect(modelDimensions(model,DEFAULT_TRANSFORM)).toEqual([20,20,20]);
    } finally {model.geometry.dispose();}
  });

  it('imports ASCII geometry without interpreting text bytes as a face count',async()=>{
    const triangles=[[[0,0,0],[0,10,0],[10,0,0]],[[0,0,0],[10,0,0],[0,0,10]],[[0,0,0],[0,0,10],[0,10,0]],[[10,0,0],[0,10,0],[0,0,10]]];
    const text='solid tetra\n'+triangles.map(vertices=>'facet normal 0 0 0\nouter loop\n'+vertices.map(vertex=>'vertex '+vertex.join(' ')).join('\n')+'\nendloop\nendfacet\n').join('')+'endsolid tetra\n';
    const model=await readModel(new File([text],'tetra.stl'));
    try {expect(model.triangles).toBe(4);expect(modelDimensions(model,DEFAULT_TRANSFORM)).toEqual([10,10,10]);}
    finally {model.geometry.dispose();}
  });

  it('reports a truncated binary file without discarding or inventing triangles',async()=>{
    // Synthetic bytes reproduce the reported length/count mismatch without
    // including any geometry from the user's private model in the source.
    const bytes=new ArrayBuffer(25_304);
    new DataView(bytes).setUint32(80,540,true);
    await expect(readModel(new File([bytes],'incomplete.stl'))).rejects.toThrow('only 504 of 540 triangles are complete');
  });

  it('rejects a truncated final record even if the binary header starts solid',async()=>{
    const bytes=binaryCube();
    new Uint8Array(bytes).set(new TextEncoder().encode('solid binary exporter'));
    await expect(readModel(new File([bytes.slice(0,-10)],'cut.stl'))).rejects.toThrow('only 11 of 12 triangles are complete');
  });

  it('rejects short headers and excessive declared counts before loader allocation',async()=>{
    await expect(readModel(new File([new Uint8Array(40)],'short.stl'))).rejects.toThrow('binary header is cut off');
    const bytes=new ArrayBuffer(84);
    new DataView(bytes).setUint32(80,0xffffffff,true);
    await expect(readModel(new File([bytes],'bad-count.stl'))).rejects.toThrow('more than 1 million triangles');
  });
});
