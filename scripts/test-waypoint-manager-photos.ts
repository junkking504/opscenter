import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {Readable} from 'node:stream';
import {job} from './fixtures/crew-progress';
import type {DesktopAppointment} from '../lib/desktop-schedule';
import {managerPhotoSource,managerPhotoProjection,managerPhotoSelection,managerPhotoUrl,publicManagerPhotoAddress,readManagerPhoto,MANAGER_PHOTO_MAX_BYTES,managerPhotoIO} from '../lib/waypoint-manager-photos';
const date='2026-10-23',url='https://junkware.junk-king.com/system/aspnet/local/media/2026-10/fixture-101-before.jpg';
const row={...job(),recordId:`${date}:appointment:101`,photos:[{url,fileName:'fixture-101-before.jpg',category:'Before' as const}]} as DesktopAppointment;
const raw=structuredClone(row),projection=managerPhotoProjection(Object.assign({},row,{sourceEstimate:{photos:[{url}]}}),date);
assert.ok(projection.photos[0].url.startsWith('/api/crew-jobs/manager?'));
assert.ok(!JSON.stringify(projection).includes('junkware.junk-king.com'));
assert.equal(projection.sourceEstimate,undefined);assert.deepEqual(row,raw);
const params=new URL(managerPhotoUrl(date,row,url),'https://fixture.invalid').searchParams;
assert.equal(managerPhotoSelection(params,()=>({appointments:[row]})),url);
for(const [key,value] of [['recordId',`${date}:appointment:102`],['date','2026-10-22'],['date','2026-02-30'],['photo','0'.repeat(64)],['url',url]]){
 const bad=new URLSearchParams(params);bad.set(key,value);assert.throws(()=>managerPhotoSelection(bad,()=>({appointments:[row]})));
}
assert.throws(()=>managerPhotoSelection(params,()=>({appointments:[]})));
assert.throws(()=>managerPhotoSelection(params,()=>({appointments:[row,row]})));
const duplicates=new URLSearchParams(params);duplicates.append('photo',params.get('photo')!);assert.throws(()=>managerPhotoSelection(duplicates,()=>({appointments:[row]})));
for(const invalid of ['http://junkware.junk-king.com/system/aspnet/local/media/a.jpg','https://evil.invalid/system/aspnet/local/media/a.jpg','https://junkware.junk-king.com.evil.invalid/system/aspnet/local/media/a.jpg',url+'?secret=123',url+'#secret',url.replace('https://','https://user:pass@'),url.replace('.com/','.com:444/'),url.replace('fixture-101-before.jpg','%2e%2e%2fsecret.jpg'),url.replace('fixture-101-before.jpg','a.svg'),url.replace('/media/','/config/')])assert.equal(managerPhotoSource(invalid),null,invalid);
assert.ok(managerPhotoSource(url));
for(const ip of ['127.0.0.1','10.1.2.3','172.16.1.1','192.168.1.1','169.254.169.254','100.64.0.1','0.0.0.0','224.0.0.1','198.18.0.1','::1','::ffff:127.0.0.1','fc00::1','fe80::1','192.0.2.1','not-an-ip'])assert.equal(publicManagerPhotoAddress(ip),false,ip);
assert.equal(publicManagerPhotoAddress('8.8.8.8'),true);
const jpg=Buffer.from([255,216,255,224,1,2,3]);let calls=0;
function fake({status=200,type='image/jpeg',bytes=jpg,length=bytes.length,encoding='',addresses=[{address:'8.8.8.8',family:4}]}:{status?:number;type?:string;bytes?:Buffer;length?:number;encoding?:string;addresses?:Array<{address:string;family:number}>}={}) {
 return {resolve:async()=>addresses,request:((target:URL,options:Record<string,any>,callback:(response:unknown)=>void)=>{
  calls++;assert.equal(target.href,url);assert.equal(options.method,'GET');assert.equal(options.agent,false);assert.deepEqual(Object.keys(options.headers).sort(),['Accept','Accept-Encoding']);
  options.lookup('junkware.junk-king.com',{},(error:unknown,address:string,family:number)=>{assert.equal(error,null);assert.equal(address,'8.8.8.8');assert.equal(family,4);});
  const req=new EventEmitter() as any;req.destroy=()=>{};req.end=()=>queueMicrotask(()=>{
   const response=Readable.from([bytes]) as any;response.statusCode=status;response.headers={'content-type':type,'content-length':String(length),'content-encoding':encoding};callback(response);
  });return req;
 }) as typeof managerPhotoIO.request};
}
async function main(){
 assert.deepEqual((await readManagerPhoto(url,fake())).bytes,jpg);
 for(const spec of [{status:302},{status:404},{type:'text/html'},{type:'image/svg+xml'},{bytes:Buffer.from('<html>')},{encoding:'gzip'},{length:MANAGER_PHOTO_MAX_BYTES+1},{bytes:Buffer.alloc(MANAGER_PHOTO_MAX_BYTES+1),length:0}])await assert.rejects(readManagerPhoto(url,fake(spec)),/Photo unavailable/);
 const before=calls;await assert.rejects(readManagerPhoto(url,fake({addresses:[{address:'127.0.0.1',family:4}]})));await assert.rejects(readManagerPhoto(url,fake({addresses:[{address:'8.8.8.8',family:4},{address:'10.0.0.1',family:4}]})));await assert.rejects(readManagerPhoto('https://evil.invalid/x.jpg',fake()));assert.equal(calls,before,'Rejected hosts/DNS never make a request');
 console.log('PASS manager photo security: source URL redaction, exact date/record/photo binding, closed host/path policy, public pinned IPv4, redirects rejected, no credential forwarding, MIME/signature/encoding and streaming size limits. Fictional transport only.');
}
void main().catch(error=>{console.error(error);process.exitCode=1;});
