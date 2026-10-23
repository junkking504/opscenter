import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {sendAppleWakeup} from '../lib/web-push-transport';
import {createECDH,createDecipheriv,createHmac,randomBytes} from 'node:crypto';
import {encryptPushMessage,pushMessage,pushPath} from '../lib/web-push-message';
const ua=createECDH('prime256v1');ua.generateKeys();const auth=randomBytes(16),endpoint='https://web.push.apple.com/Q'+'x'.repeat(64);
const envelope={subscription:{endpoint,keys:{p256dh:ua.getPublicKey().toString('base64url'),auth:auth.toString('base64url')}},message:{title:'Schedule updated',body:'Date: 2026-10-22\nTime: 12 PM – 1 PM (Central)\nJob: JK123\nTruck: #4',eventId:'a'.repeat(64),path:'/jobs?date=2026-10-22#job-jk123'}};
const encrypted=encryptPushMessage(envelope);
// Independent HKDF extract/expand via HMAC; receiver derives from sender public
// key, never from implementation internals. No provider or deployed key used.
const derive=(ikm:Buffer,salt:Buffer,info:Buffer,length:number)=>createHmac('sha256',createHmac('sha256',salt).update(ikm).digest()).update(Buffer.concat([info,Buffer.from([1])])).digest().subarray(0,length);
function decrypt(buffer:Buffer,receiver=ua){
 const salt=buffer.subarray(0,16);assert.equal(buffer.readUInt32BE(16),4096);assert.equal(buffer[20],65);
 const as=buffer.subarray(21,86),record=buffer.subarray(86);
 const ikm=derive(receiver.computeSecret(as),auth,Buffer.concat([Buffer.from('WebPush: info\0'),ua.getPublicKey(),as]),32);
 const key=derive(ikm,salt,Buffer.from('Content-Encoding: aes128gcm\0'),16),nonce=derive(ikm,salt,Buffer.from('Content-Encoding: nonce\0'),12);
 const decipher=createDecipheriv('aes-128-gcm',key,nonce);decipher.setAuthTag(record.subarray(-16));
 const plain=Buffer.concat([decipher.update(record.subarray(0,-16)),decipher.final()]);assert.equal(plain.at(-1),2);return JSON.parse(plain.subarray(0,-1).toString());
}
assert.deepEqual(decrypt(encrypted),envelope.message);assert.equal(encrypted.includes(Buffer.from('JK123')),false);
assert.notDeepEqual(encryptPushMessage(envelope),encrypted,'fresh key and salt per attempt');
const tampered=Buffer.from(encrypted);tampered[tampered.length-20]^=1;assert.throws(()=>decrypt(tampered));
const wrong=createECDH('prime256v1');wrong.generateKeys();assert.throws(()=>decrypt(encrypted,wrong));
assert.throws(()=>encryptPushMessage({...envelope,subscription:{...envelope.subscription,keys:{...envelope.subscription.keys,auth:'bad'}}}));
const detailed=pushMessage({title:'Rescheduled',body:'Date: 2026-10-22\r\nJob: JK123\n'+('Detail: useful information\n'.repeat(40)),schedule:{private:true}})!;
assert.ok(detailed.body.length>700&&detailed.body.includes('\nJob: JK123\n'));
assert.deepEqual(decrypt(encryptPushMessage({...envelope,message:{...detailed,eventId:'b'.repeat(64)}})),{...detailed,eventId:'b'.repeat(64)});
assert.equal('schedule' in detailed,false,'private correlation context never enters the wire payload');
assert.equal(pushMessage({title:'New\nappointment',body:'Line 1\r\nLine 2\u0000'})?.body,'Line 1\nLine 2');
assert.equal(pushMessage({title:'New\nappointment',body:'Body'})?.title,'New appointment');
for(const fragment of ['😀','"\n','é','字']){
 const bounded=pushMessage({title:'Truck #9',body:fragment.repeat(3000),path:'/jobs?date=2026-10-22#job-jk123'})!;
 assert.ok(Buffer.byteLength(JSON.stringify(bounded))<=2800);
 assert.ok(bounded.body.endsWith('…'));
 assert.ok(!/[\uD800-\uDFFF]/u.test(bounded.body),'no isolated surrogate');
 const decoded=decrypt(encryptPushMessage({...envelope,message:{...bounded,eventId:'c'.repeat(64)}}));
 assert.deepEqual(decoded,{...bounded,eventId:'c'.repeat(64)});
}
console.log('Encrypted Web Push receiver round-trip, separate HMAC HKDF, tampering, wrong handset, fresh salt/key and plaintext exclusion passed.');

let wire:Buffer|undefined,headers:Record<string,string>|undefined;
const io={enabled:()=>true,resolve:async()=>[{address:'17.0.0.1',family:4}],authorization:()=> 'synthetic-vapid',now:()=>1000,
 request:((_url:unknown,options:{headers:Record<string,string>},callback:(res:{statusCode:number;destroy:()=>void})=>void)=>{
  headers=options.headers;const req=new EventEmitter() as EventEmitter&{end:(body?:Buffer)=>void;destroy:()=>void};
  req.destroy=()=>{req.emit('close')};req.end=body=>{wire=body;queueMicrotask(()=>{callback({statusCode:201,destroy:()=>{}});req.emit('close')})};return req;
 }) as unknown as typeof import('node:https').request};
async function transport(){
 assert.equal(await sendAppleWakeup(endpoint,async()=>true,2000,io,envelope),201);
 assert.equal(headers?.['Content-Encoding'],'aes128gcm');assert.equal(headers?.['Content-Type'],'application/octet-stream');
 assert.equal(headers?.['Content-Length'],String(wire!.length));assert.deepEqual(decrypt(wire!),envelope.message);
 await assert.rejects(sendAppleWakeup(endpoint,async()=>true,2000,io,{...envelope,subscription:{...envelope.subscription,endpoint:endpoint+'x'}}),/destination mismatch/);
 console.log('Encrypted HTTP body/header and exact encryption-destination checks passed with mocked transport.');
}
transport().catch(e=>{console.error(e);process.exitCode=1});

assert.equal(pushPath('/jobs?date=2026-10-22#job-jk123'),'/jobs?date=2026-10-22#job-jk123');
for(const path of ['https://evil.test/jobs','//evil.test','/jobs?date=2026-02-30#job-jk123','/jobs?date=2026-10-22#job-123','/jobs?date=2026-10-22#job-jk123&next=https://evil.test','/jobs?date=2026-10-22#job-jk123%0a','/jobs?date=2026-10-22#job-jk123\n','/api/private','/jobs?date=2026-10-22#job-jk'+'9'.repeat(13)]) {
 assert.equal(pushPath(path),undefined);
 assert.equal('path' in pushMessage({title:'Truck #9',body:'Estimate Completed',path})!,false);
}
