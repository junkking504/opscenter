import { createCipheriv, createECDH, hkdfSync, randomBytes } from 'node:crypto';
import type { PushSubscriptionRecord } from './web-push-store';
export type PushMessage={title:string;body:string;eventId?:string;path?:string};
export type PushEnvelope={message:PushMessage;subscription:PushSubscriptionRecord;recordedAt?:string};
/** Only an existing authenticated job route, never a payload URL or media link. */
export function pushPath(value:unknown):string|undefined {
 if(typeof value!=='string')return undefined;
 const match=value.match(/^\/jobs\?date=(\d{4}-\d{2}-\d{2})#job-jk[0-9]{1,12}$/);
 if(!match)return undefined;
 const date=new Date(match[1]+'T12:00:00Z');
 return Number.isFinite(date.getTime())&&date.toISOString().slice(0,10)===match[1]?value:undefined;
}
export function pushMessage(value:unknown):PushMessage|null {
 const v=value as Partial<PushMessage>|undefined;
 if(!v||typeof v.title!=='string'||typeof v.body!=='string'||!v.title.trim()||!v.body.trim())return null;
 const clean=(s:string,n:number,multiline=false)=>Array.from(s.replace(/\r\n/g,'\n').replace(multiline?/[\u0000-\u0009\u000b-\u001f\u007f]/g:/[\u0000-\u001f\u007f]/g,' ').trim()).slice(0,n).join('');
 const title=clean(v.title,100),body=Array.from(clean(v.body,1600,true)),path=pushPath(v.path);
 let clipped=Array.from(v.body).length>1600;
 // Bound the serialized UTF-8 bytes (including JSON escaping), leaving room
 // for eventId under the encrypted-message limit. Never split a code point.
 while(Buffer.byteLength(JSON.stringify({title,body:body.join('')+(clipped?'…':''),...(path?{path}:{})}))>2800){body.pop();clipped=true;}
 return {title,body:body.join('')+(clipped?'…':''),...(path?{path}:{})};
}
/** RFC 8291 / RFC 8188 single-record aes128gcm. Fresh ephemeral key and salt. */
export function encryptPushMessage(envelope:PushEnvelope):Buffer {
 const ua=Buffer.from(envelope.subscription.keys.p256dh,'base64url'),auth=Buffer.from(envelope.subscription.keys.auth,'base64url');
 if(ua.length!==65||ua[0]!==4||auth.length!==16)throw new Error('Invalid push encryption keys.');
 const message=pushMessage(envelope.message);if(!message)throw new Error('Invalid push message.');
 const eventId=/^[a-f0-9]{64}$/.test(envelope.message.eventId||'')?envelope.message.eventId:undefined;
 const plain=Buffer.from(JSON.stringify({...message,eventId}));if(plain.length>3000)throw new Error('Push message too large.');
 const sender=createECDH('prime256v1');sender.generateKeys();const publicKey=sender.getPublicKey();
 const ikm=Buffer.from(hkdfSync('sha256',sender.computeSecret(ua),auth,Buffer.concat([Buffer.from('WebPush: info\0'),ua,publicKey]),32));
 const salt=randomBytes(16);
 const cek=Buffer.from(hkdfSync('sha256',ikm,salt,Buffer.from('Content-Encoding: aes128gcm\0'),16));
 const nonce=Buffer.from(hkdfSync('sha256',ikm,salt,Buffer.from('Content-Encoding: nonce\0'),12));
 const cipher=createCipheriv('aes-128-gcm',cek,nonce);const encrypted=Buffer.concat([cipher.update(Buffer.concat([plain,Buffer.from([2])])),cipher.final(),cipher.getAuthTag()]);
 const header=Buffer.alloc(21);salt.copy(header);header.writeUInt32BE(4096,16);header[20]=publicKey.length;
 return Buffer.concat([header,publicKey,encrypted]);
}
