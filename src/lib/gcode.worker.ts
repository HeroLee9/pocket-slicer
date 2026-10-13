import {parseGcode} from './gcode';
self.onmessage=(event:MessageEvent<Uint8Array>)=>{
  try {const preview=parseGcode(new TextDecoder().decode(event.data));self.postMessage({preview},{transfer:[preview.positions.buffer,preview.colors.buffer]});}
  catch(error){self.postMessage({error:error instanceof Error?error.message:String(error)});}
};
