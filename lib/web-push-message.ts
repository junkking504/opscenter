import { createCipheriv, createECDH, hkdfSync, randomBytes } from 'node:crypto';
import type { PushSubscriptionRecord } from './web-push-store';
export type PushMessage={title:string;body:string;eventId?:string};
export type PushEnvelope={message:PushMessage;subscription:PushSubscriptionRecord};
export function pushMessage(value:unknown):PushMessage|null {
 const v=value as Partial<PushMessage>|undefined;
 if(!v||typeof v.title!=='string'||typeof v.body!=='string'||!v.title.trim()||!v.body.trim())return null;
 const clean=(s:string,n:number)=>s.replace(/[\u0000-\u001f\u007f]/g,' ').trim().slice(0,n);
 return {title:clean(v.title,100),body:clean(v.body,700)};
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
