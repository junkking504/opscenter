import fs from 'node:fs';
import path from 'node:path';
import https from 'node:https';
import { lookup } from 'node:dns/promises';
import { createHash, randomUUID } from 'node:crypto';
import { publicPushAddress, sendAppleNotification } from './web-push-transport';
import { pushMessage, type PushEnvelope } from './web-push-message';
import { trialFingerprint } from './web-push-trial';
import { supervisedPushDelivery } from './web-push-runtime';

// This new host intentionally fails the installed spending gate until its
// separately approved inventory update. Never disguise it or bypass that gate.
const origin = 'https://api.pushover.net';
type Approval = {
  schema: 1; enabled: true; provider: 'pushover'; purpose: 'opscenter-notifications';
  approvedAt: string; expiresAt: string; approvalReference: string;
  maxAdditionalSpendMicros: 0; maxAttempts: number; content: 'existing-alert-details';
  subscriptionFingerprint: string; token: string; user: string; device: string;
};
type Response = {status: number; body: Record<string, unknown>};
type Post = (route: '/1/users/validate.json'|'/1/messages.json', fields: URLSearchParams,
  authorize: ()=>Promise<boolean>, deadline: number)=>Promise<Response>;
export type PushoverIO = {
  configPath: ()=>string|undefined; enabled: ()=>boolean; now: ()=>number;
  post: Post; apple: typeof sendAppleNotification;
};
const digest = (value: string)=>createHash('sha256').update(value).digest('hex');
function fail(): never { throw new Error('pushover_configuration_or_authorization_invalid'); }

function privateJSON(file: string): {raw: string; value: unknown} {
  const fd=fs.openSync(file,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW);
  try {
    const stat=fs.fstatSync(fd);
    if(!stat.isFile()||(stat.mode&0o077)!==0||stat.uid!==process.getuid?.()||stat.size>16384)fail();
    const raw=fs.readFileSync(fd,'utf8');
    return {raw,value:JSON.parse(raw)};
  } finally {fs.closeSync(fd);}
}
export function readPushoverApproval(file: string, now: number): {approval: Approval; hash: string} {
  if(!path.isAbsolute(file))fail();
  const {raw,value}=privateJSON(file), a=value as Approval;
  const start=Date.parse(a?.approvedAt),end=Date.parse(a?.expiresAt);
  if(a?.schema!==1||a.enabled!==true||a.provider!=='pushover'||a.purpose!=='opscenter-notifications'
    ||a.maxAdditionalSpendMicros!==0||a.content!=='existing-alert-details'
    ||!Number.isInteger(a.maxAttempts)||a.maxAttempts<1||a.maxAttempts>10000
    ||!Number.isFinite(start)||!Number.isFinite(end)||start>now||end<=now||end-start>30*86400000
    ||typeof a.approvalReference!=='string'||!a.approvalReference.trim()
    ||! /^[a-f0-9]{64}$/.test(a.subscriptionFingerprint)
    ||! /^[a-zA-Z0-9]{30}$/.test(a.token)||! /^[a-zA-Z0-9]{30}$/.test(a.user)
    ||! /^[a-zA-Z0-9_-]{1,25}$/.test(a.device))fail();
  return {approval:a,hash:digest(raw)};
}

/** A preinitialized ledger is mandatory. Reserve before any provider I/O and
 * never refund failures. A crash holding the lock requires operator inspection.
 * Lifetime cap, max 30 days, is stricter than a calendar-month allowance. */
export function reservePushover(file: string, approval: Approval): void {
  const ledger=file+'.ledger.json',lock=ledger+'.lock';
  fs.mkdirSync(lock,{mode:0o700});
  try {
    const state=privateJSON(ledger).value as {schema:number;approvalReference:string;attempts:number};
    if(state.schema!==1||state.approvalReference!==approval.approvalReference
      ||!Number.isSafeInteger(state.attempts)||state.attempts<0||state.attempts>=approval.maxAttempts)fail();
    const temp=ledger+'.'+randomUUID();
    try {
      const fd=fs.openSync(temp,'wx',0o600);
      try {fs.writeFileSync(fd,JSON.stringify({...state,attempts:state.attempts+1}));fs.fsyncSync(fd);}finally{fs.closeSync(fd);}
      fs.renameSync(temp,ledger);
      const dir=fs.openSync(path.dirname(ledger),'r');
      try{fs.fsyncSync(dir);}finally{fs.closeSync(dir);}
    }finally{if(fs.existsSync(temp))fs.unlinkSync(temp);}
  }finally{fs.rmdirSync(lock);}
}

/** Fixed host/path, public pinned IPv4, no redirects, bounded response and time.
 * Secrets and response bodies must never be logged. */
const postPushover: Post = async (route,fields,authorize,deadline) => {
  let timer:ReturnType<typeof setTimeout>|undefined;
  const timeout=Math.min(3000,deadline-Date.now());
  if(timeout<1||!await authorize())fail();
  const addresses=await Promise.race([
    lookup(new URL(origin).hostname,{family:4,all:true}),
    new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(new Error('pushover_dns_timeout')),timeout);}),
  ]).finally(()=>clearTimeout(timer));
  if(!addresses.length||addresses.some(row=>!publicPushAddress(row.address)))fail();
  if(!await authorize()||Date.now()>=deadline)fail();
  const body=fields.toString();
  return new Promise<Response>((resolve,reject)=>{
    const request=https.request(new URL(route,origin),{
      method:'POST',agent:false,
      headers:{'Content-Type':'application/x-www-form-urlencoded','Content-Length':Buffer.byteLength(body)},
      lookup:(_host,_options,callback)=>callback(null,addresses[0].address,4),
    },response=>{
      const chunks:Buffer[]=[];let length=0;
      response.on('data',(chunk:Buffer)=>{length+=chunk.length;if(length>8192)request.destroy(new Error('pushover_response_too_large'));else chunks.push(chunk);});
      response.on('error',()=>request.destroy(new Error('pushover_response_failed')));
      response.on('end',()=>{
        try{const parsed=JSON.parse(Buffer.concat(chunks).toString('utf8'));if(!parsed||typeof parsed!=='object'||Array.isArray(parsed))throw Error();resolve({status:response.statusCode||0,body:parsed});}
        catch{reject(new Error('pushover_response_invalid'));}
      });
    });
    const requestTimer=setTimeout(()=>request.destroy(new Error('pushover_timeout')),Math.min(8000,Math.max(1,deadline-Date.now())));
    request.on('close',()=>clearTimeout(requestTimer));
    request.on('error',()=>reject(new Error('pushover_transport_unknown')));
    request.end(body);
  });
};
const defaultIO: PushoverIO={configPath:()=>process.env.OPSCENTER_PUSHOVER_CONFIG,
  enabled:supervisedPushDelivery,now:Date.now,post:postPushover,apple:sendAppleNotification};

export function pushoverFields(a: Approval,envelope: PushEnvelope,ttl: number): URLSearchParams {
  const message=pushMessage(envelope.message);if(!message)fail();
  // Pushover permits 1024 message characters; count UTF-16 conservatively.
  let body=message.body;
  if(body.length>1024){body=body.slice(0,1023).replace(/[\uD800-\uDBFF]$/,'')+'…';}
  return new URLSearchParams({token:a.token,user:a.user,device:a.device,title:message.title,message:body,
    priority:'0',ttl:String(ttl),url:'https://ops.junk-king.app'+(message.path||'/desktop'),url_title:'Open in OpsCenter'});
  // Deliberately omit sound so the user's Pushover sound preference is honored.
}

/** Substitute only the separately approved subscription. All existing device,
 * role, category, expiry, claim and no-retry checks remain in the dispatcher.
 * No Apple fallback after a Pushover attempt, even on error/uncertain response. */
export async function sendManagerNotification(endpoint: string,authorize: ()=>Promise<boolean>,deadline: number,
  envelope?: PushEnvelope,io: PushoverIO=defaultIO): Promise<number> {
  const file=io.configPath();
  if(!file)return io.apple(endpoint,authorize,deadline,envelope);
  if(!io.enabled()||!envelope||envelope.subscription.endpoint!==endpoint)fail();
  const {approval:a,hash}=readPushoverApproval(file,io.now());
  if(trialFingerprint(envelope.subscription)!==a.subscriptionFingerprint)return io.apple(endpoint,authorize,deadline,envelope);
  const recorded=Date.parse(envelope.recordedAt||'');
  if(!Number.isFinite(recorded)||recorded<Date.parse(a.approvedAt)||recorded>io.now())return 400;
  const allowed=async()=>{
    try{return io.enabled()&&io.configPath()===file&&io.now()<deadline
      &&readPushoverApproval(file,io.now()).hash===hash&&await authorize();}catch{return false;}
  };
  if(!await allowed())fail();
  const expires=Math.min(deadline,Date.parse(a.expiresAt),io.now()+8000);
  const fields=pushoverFields(a,envelope,Math.max(1,Math.min(300,Math.floor((Math.min(deadline,Date.parse(a.expiresAt))-io.now())/1000))));
  reservePushover(file,a);
  const validation=await io.post('/1/users/validate.json',new URLSearchParams({token:a.token,user:a.user,device:a.device}),allowed,expires);
  // Refuse groups, renamed devices, or additional account devices. Pushover's
  // device parameter can otherwise fall back to other active devices. There is
  // still a provider-side race if devices change between validation and send.
  if(validation.status!==200||validation.body.status!==1||validation.body.group===1||!Array.isArray(validation.body.devices)
    ||validation.body.devices.length!==1||validation.body.devices[0]!==a.device)return 400;
  if(!await allowed()||io.now()>=expires)fail();
  const sent=await io.post('/1/messages.json',fields,allowed,expires);
  // Existing receipt vocabulary: 201 means provider acceptance, not handset
  // delivery. Never propagate Pushover 404/410 as Apple subscription expiry.
  return sent.status===200&&sent.body.status===1?201:400;
}
