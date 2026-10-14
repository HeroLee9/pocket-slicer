import {parseGcode,parseSupportPreview} from './gcode';
self.onmessage=async(event:MessageEvent<Uint8Array|Blob|{kind:'supports';gcode:Uint8Array|Blob}>)=>{
  try {
    const supports='kind' in event.data&&event.data.kind==='supports';
    const source='kind' in event.data?event.data.gcode:event.data;
    const input=source instanceof Blob?new Uint8Array(await source.arrayBuffer()):source;
    const preview=supports?parseSupportPreview(input):parseGcode(input);
    const transfer=[preview.positions.buffer,preview.colors.buffer];
    if('widths' in preview)transfer.push(preview.widths.buffer,preview.heights.buffer);
    self.postMessage({preview},{transfer});
  }catch(error){self.postMessage({error:error instanceof Error?error.message:String(error)});}
};
