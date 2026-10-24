import {createHash} from 'node:crypto';
import {lookup} from 'node:dns/promises';
import {BlockList,isIP} from 'node:net';
import https from 'node:https';
import type {DesktopAppointment} from './desktop-schedule';
import {CrewPhoneError} from './crew-phone';

export const MANAGER_PHOTO_MAX_BYTES=10*1024*1024;
export const managerPhotoHeaders={'Cache-Control':'private, no-store, max-age=0','X-Content-Type-Options':'nosniff','Cross-Origin-Resource-Policy':'same-origin','Content-Security-Policy':"default-src 'none'; sandbox",'Referrer-Policy':'no-referrer'};
const unavailable=()=>new CrewPhoneError('Photo unavailable. Refresh the appointment and try again.',404);
export function managerPhotoSource(raw:string):URL|null {
 try {
  const url=new URL(raw),decoded=decodeURIComponent(url.pathname);
  if(url.protocol!=='https:'||url.hostname!=='junkware.junk-king.com'||url.port||url.username||url.password||url.search||url.hash
   ||!decoded.startsWith('/system/aspnet/local/media/')||decoded.split('/').some(part=>part==='.'||part==='..')||/[\\\x00-\x1f]/.test(decoded)||! /\.(?:jpe?g|png|webp)$/i.test(decoded))return null;
  return url;
 }catch{return null;}
}
const photoKey=(date:string,recordId:string,url:string)=>createHash('sha256').update(JSON.stringify([date,recordId,url])).digest('hex');
export function managerPhotoUrl(date:string,row:Pick<DesktopAppointment,'recordId'>,url:string) {
 return `/api/crew-jobs/manager?${new URLSearchParams({resource:'photo',date,recordId:row.recordId,photo:photoKey(date,row.recordId,url)})}`;
}
// Do not send public media URLs (including prior estimate media) to this surface.
export function managerPhotoProjection(row:DesktopAppointment,date:string) {
 return {...row,sourceEstimate:undefined,photos:(row.photos || []).map(photo=>({category:photo.category,fileName:`${photo.category} photo`,url:managerPhotoSource(photo.url)?managerPhotoUrl(date,row,photo.url):''}))};
}
// Existing edit and receipt reads can embed raw closeout photo evidence. The
// manager forms need neither those URLs nor prior-estimate media. Redact only
// their response projection; saved receipts, notes and source versions stay intact.
export function managerResponseProjection(value:unknown):unknown {
 if(Array.isArray(value))return value.map(managerResponseProjection);
 if(!value||typeof value!=='object')return value;
 return Object.fromEntries(Object.entries(value).map(([key,item])=>{
  if(key==='photoEvidence'&&item&&typeof item==='object'&&!Array.isArray(item)){
   const {urls,...evidence}=item as Record<string,unknown>;
   return [key,{...managerResponseProjection(evidence) as Record<string,unknown>,...(Array.isArray(urls)?{photoCount:urls.length,urlsRedacted:true}:{})}];
  }
  if(key==='photos'&&Array.isArray(item))return [key,item.map(photo=>({category:photo?.category||'Other',fileName:'Appointment photo',url:''}))];
  if(key==='sourceEstimate')return [key,undefined];
  return [key,managerResponseProjection(item)];
 }));
}
export function managerPhotoSelection(params:URLSearchParams,read:(date:string)=>{appointments:DesktopAppointment[]}) {
 const date=params.get('date')||'',recordId=params.get('recordId')||'',key=params.get('photo')||'';
 if(params.size!==4||[...params.keys()].some(name=>!['resource','date','recordId','photo'].includes(name))||params.get('resource')!=='photo'
  ||!/^\d{4}-\d{2}-\d{2}$/.test(date)||!Number.isFinite(Date.parse(date))||new Date(date+'T12:00:00Z').toISOString().slice(0,10)!==date
  ||!recordId||recordId.length>200||!/^[a-f0-9]{64}$/.test(key))throw unavailable();
 const rows=read(date).appointments.filter(row=>row.recordId===recordId);
 if(rows.length!==1)throw unavailable();
 const photos=(rows[0].photos||[]).filter(photo=>photoKey(date,recordId,photo.url)===key);
 if(photos.length!==1||!managerPhotoSource(photos[0].url))throw unavailable();
 return photos[0].url;
}
const blocked=new BlockList();
for(const [address,prefix] of [['0.0.0.0',8],['10.0.0.0',8],['100.64.0.0',10],['127.0.0.0',8],['169.254.0.0',16],['172.16.0.0',12],['192.0.0.0',24],['192.0.2.0',24],['192.168.0.0',16],['198.18.0.0',15],['198.51.100.0',24],['203.0.113.0',24],['224.0.0.0',3]] as const)blocked.addSubnet(address,prefix,'ipv4');
export const publicManagerPhotoAddress=(address:string)=>isIP(address)===4&&!blocked.check(address,'ipv4');
export const managerPhotoIO={resolve:(hostname:string)=>lookup(hostname,{family:4,all:true}),request:https.request};
export async function readManagerPhoto(raw:string,io=managerPhotoIO) {
 const url=managerPhotoSource(raw);if(!url)throw unavailable();
 let dnsTimer:ReturnType<typeof setTimeout>|undefined;
 const addresses=await Promise.race([io.resolve(url.hostname),new Promise<never>((_,reject)=>{dnsTimer=setTimeout(()=>reject(unavailable()),3000);})]).finally(()=>clearTimeout(dnsTimer));
 if(!addresses.length||addresses.some(row=>!publicManagerPhotoAddress(row.address)))throw unavailable();
 const address=addresses[0].address;
 return new Promise<{bytes:Buffer;mimeType:string}>((resolve,reject)=>{
  let timer:ReturnType<typeof setTimeout>|undefined;
  const req=io.request(url,{method:'GET',agent:false,headers:{Accept:'image/jpeg,image/png,image/webp','Accept-Encoding':'identity'},
   // Pin the validated public IPv4; TLS still verifies the original host.
   lookup:((_host:string,options:{all?:boolean},callback:(error:null,address:string|Array<{address:string;family:number}>,family?:number)=>void)=>options.all?callback(null,[{address,family:4}]):callback(null,address,4)) as NonNullable<https.RequestOptions['lookup']>},response=>{
    const mimeType=String(response.headers['content-type']||'').split(';')[0].trim().toLowerCase();
    const fail=()=>{clearTimeout(timer);response.destroy();req.destroy();reject(unavailable());};
    // Native HTTPS never follows redirects. No source cookies, bearer tokens or
    // incoming request headers are forwarded, and no upstream errors escape.
    if(response.statusCode!==200||!['image/jpeg','image/png','image/webp'].includes(mimeType)||!['','identity'].includes(String(response.headers['content-encoding']||''))||Number(response.headers['content-length'])>MANAGER_PHOTO_MAX_BYTES){fail();return;}
    const chunks:Buffer[]=[];let size=0;
    response.on('data',(chunk:Buffer)=>{size+=chunk.length;if(size>MANAGER_PHOTO_MAX_BYTES){fail();return;}chunks.push(chunk);});
    response.on('error',fail);response.on('aborted',fail);
    response.on('end',()=>{
     clearTimeout(timer);const bytes=Buffer.concat(chunks);
     const valid=mimeType==='image/jpeg'?bytes.length>=3&&bytes[0]===255&&bytes[1]===216&&bytes[2]===255:mimeType==='image/png'?bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])):bytes.length>=12&&bytes.toString('ascii',0,4)==='RIFF'&&bytes.toString('ascii',8,12)==='WEBP';
     if(!valid){reject(unavailable());return;}resolve({bytes,mimeType});
    });
   });
  req.on('error',()=>{clearTimeout(timer);reject(unavailable());});
  timer=setTimeout(()=>{req.destroy();reject(unavailable());},10000);req.end();
 });
}
