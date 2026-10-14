import {parseGcode} from './gcode';
self.onmessage=async(event:MessageEvent<Uint8Array|Blob>)=>{
  try {
    const input=event.data instanceof Blob?new Uint8Array(await event.data.arrayBuffer()):event.data;
    const preview=parseGcode(input);
    self.postMessage({preview},{transfer:[preview.positions.buffer,preview.colors.buffer]});
  }catch(error){self.postMessage({error:error instanceof Error?error.message:String(error)});}
};
