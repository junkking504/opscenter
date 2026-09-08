import {googleMapJson,googleMapRequest} from './google-map-transport';
type Session={token:string;expiry:number};
let session:Session|null=null,pending:Promise<Session|null>|null=null;
// Session tokens are reusable per Google's session-token contract. Tile content
// is streamed for the current view, never persisted or prefetched server-side.
async function mapSession():Promise<Session|null> {
  if(session && session.expiry>Date.now()+60_000) return session;
  if(pending) return pending;
  pending=(async()=>{
    const result=await googleMapJson('tile.googleapis.com','/v1/createSession',{mapType:'roadmap',language:'en-US',region:'US',imageFormat:'png'}) as {session?:unknown;expiry?:unknown}|null;
    const expiry=Number(result?.expiry)*1000;
    if(typeof result?.session!=='string' || !Number.isFinite(expiry) || expiry<=Date.now()) return null;
    session={token:result.session,expiry};return session;
  })();
  try{return await pending;}finally{pending=null;}
}
export function validTile(params:URLSearchParams) {
  const values=['z','x','y'].map(name=>params.get(name));
  if(values.some(v=>v===null || !/^\d{1,8}$/.test(v))) return null;
  const [z,x,y]=values.map(Number);
  return z<=20 && x<2**z && y<2**z?{z,x,y}:null;
}
export function validViewport(params:URLSearchParams) {
  const names=['zoom','north','south','east','west'];
  if(names.some(name=>!params.has(name) || params.get(name)==='')) return null;
  const [zoom,north,south,east,west]=names.map(name=>Number(params.get(name)));
  if(![zoom,north,south,east,west].every(Number.isFinite) || !Number.isInteger(zoom) || zoom<0 || zoom>20 || north>90 || south< -90 || north<south || Math.abs(east)>180 || Math.abs(west)>180) return null;
  return {zoom,north,south,east,west};
}
export async function googleTile(tile:NonNullable<ReturnType<typeof validTile>>) {
  const active=await mapSession();if(!active)return null;
  const result=await googleMapRequest('tile.googleapis.com',`/v1/2dtiles/${tile.z}/${tile.x}/${tile.y}?${new URLSearchParams({session:active.token})}`);
  return result?.contentType.startsWith('image/png')?result.data:null;
}
export async function googleViewport(viewport:NonNullable<ReturnType<typeof validViewport>>) {
  const active=await mapSession();if(!active)return null;
  const params=new URLSearchParams({session:active.token,...Object.fromEntries(Object.entries(viewport).map(([k,v])=>[k,String(v)]))});
  const result=await googleMapJson('tile.googleapis.com',`/tile/v1/viewport?${params}`) as {copyright?:unknown}|null;
  return typeof result?.copyright==='string'?{copyright:result.copyright}:null;
}
