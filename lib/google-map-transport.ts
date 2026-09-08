import {request} from 'node:https';

// Server only. Keep the existing key restricted to the approved IPv4 egress.
// Fixed hosts and caller-built paths prevent this becoming an arbitrary proxy.
export async function googleMapRequest(host:'tile.googleapis.com'|'roads.googleapis.com'|'routes.googleapis.com',path:string,body?:unknown,fieldMask?:string) {
  const key=process.env.GOOGLE_MAPS_API_KEY;
  if(!key) return null;
  const payload=body===undefined?undefined:JSON.stringify(body);
  return new Promise<{data:Buffer;contentType:string}|null>(resolve=>{
    const req=request({hostname:host,path,family:4,method:payload?'POST':'GET',signal:AbortSignal.timeout(12_000),headers:{
      'X-Goog-Api-Key':key,...(payload?{'Content-Type':'application/json','Content-Length':Buffer.byteLength(payload)}:{}),...(fieldMask?{'X-Goog-FieldMask':fieldMask}:{}),
    }},response=>{
      response.on('error',()=>resolve(null));response.on('aborted',()=>resolve(null));
      if(response.statusCode!==200) {response.resume();resolve(null);return;}
      const chunks:Buffer[]=[];let bytes=0;
      response.on('data',(chunk:Buffer)=>{bytes+=chunk.length;if(bytes>4_194_304){resolve(null);response.destroy();}else chunks.push(chunk);});
      response.on('end',()=>resolve({data:Buffer.concat(chunks),contentType:String(response.headers['content-type'] || '')}));
    });
    // Do not log raw errors, URLs, headers or responses containing keys/tokens.
    req.on('error',()=>resolve(null));req.end(payload);
  });
}
export async function googleMapJson(host:Parameters<typeof googleMapRequest>[0],path:string,body?:unknown,fieldMask?:string):Promise<unknown> {
  const response=await googleMapRequest(host,path,body,fieldMask);
  try{return response?JSON.parse(response.data.toString('utf8')):null;}catch{return null;}
}
