import { createPrivateKey, sign } from 'node:crypto';
import { lookup } from 'node:dns/promises';
import { isIP, BlockList } from 'node:net';
import https from 'node:https';
import { supervisedPushDelivery } from './web-push-runtime';
import { pushEndpoint } from './web-push-policy';
const blocked = new BlockList();
for (const [address, prefix] of [['0.0.0.0',8],['10.0.0.0',8],['100.64.0.0',10],['127.0.0.0',8],['169.254.0.0',16],['172.16.0.0',12],['192.0.0.0',24],['192.0.2.0',24],['192.168.0.0',16],['198.18.0.0',15],['198.51.100.0',24],['203.0.113.0',24],['224.0.0.0',3]] as const) blocked.addSubnet(address,prefix,'ipv4');
export function publicPushAddress(address: string): boolean {
  // IPv4 only in the pilot; no mapped/private IPv6 or DNS rebinding path.
  return isIP(address) === 4 && !blocked.check(address,'ipv4');
}
export function vapidAuthorization(endpoint: URL, env: NodeJS.ProcessEnv = process.env, now = Date.now()) {
  const pub = Buffer.from(env.OPSCENTER_WEB_PUSH_PUBLIC_KEY || '', 'base64url');
  if (pub.length !== 65 || pub[0] !== 4) throw new Error('Push key configuration invalid.');
  const key = createPrivateKey({format:'jwk', key:{kty:'EC',crv:'P-256',x:pub.subarray(1,33).toString('base64url'),y:pub.subarray(33).toString('base64url'),d:env.OPSCENTER_WEB_PUSH_PRIVATE_KEY}});
  const header = Buffer.from(JSON.stringify({typ:'JWT',alg:'ES256'})).toString('base64url');
  const claims = Buffer.from(JSON.stringify({aud:endpoint.origin,exp:Math.floor(now/1000)+3600,sub:env.OPSCENTER_WEB_PUSH_SUBJECT})).toString('base64url');
  const input = `${header}.${claims}`;
  const signature = sign('sha256',Buffer.from(input),{key,dsaEncoding:'ieee-p1363'}).toString('base64url');
  return `vapid t=${input}.${signature}, k=${pub.toString('base64url')}`;
}
export const transportDependencies={enabled:supervisedPushDelivery,resolve:(hostname:string)=>lookup(hostname,{family:4,all:true}),authorization:vapidAuthorization,request:https.request,now:Date.now};
/** Empty-body standards Web Push: no customer, employee, event or URL payload. */
export async function sendAppleWakeup(endpoint: string, authorize:()=>Promise<boolean>, deadline:number, io=transportDependencies): Promise<number> {
  if (!io.enabled()) throw new Error('Push delivery disabled.');
  const url = pushEndpoint(endpoint);
  let dnsTimer:ReturnType<typeof setTimeout>|undefined;
  const addresses = await Promise.race([io.resolve(url.hostname),new Promise<never>((_,reject)=>{dnsTimer=setTimeout(()=>reject(new Error('Push DNS timed out.')),3000);})]).finally(()=>clearTimeout(dnsTimer));
  if (!addresses.length || addresses.some(row => !publicPushAddress(row.address))) throw new Error('Push DNS rejected.');
  const address = addresses[0].address;
  if(!io.enabled()||!Number.isFinite(deadline)||io.now()>=deadline||!await authorize())throw new Error('Push attempt authorization expired.');
  const authorization = io.authorization(url);
  if(io.now()>=deadline)throw new Error('Push attempt deadline reached.');
  return new Promise((resolve,reject) => {
    const req = io.request(url, {method:'POST',agent:false,headers:{Authorization:authorization,TTL:String(Math.min(300,Math.max(0,Math.floor((deadline-io.now())/1000)))),Urgency:'normal','Content-Length':'0'},
      // Pin the validated address; TLS still verifies the original Apple name.
      lookup:((_hostname: string, options: {all?:boolean}, callback: (error: null,address: string|Array<{address:string;family:number}>,family?: number)=>void) => options.all ? callback(null,[{address,family:4}]) : callback(null,address,4)) as NonNullable<https.RequestOptions['lookup']>}, res => {
      res.destroy(); resolve(res.statusCode || 0); // Never follow redirects or read provider bodies.
    });
    const timer=setTimeout(()=>req.destroy(new Error('Push request timed out.')),Math.min(8000,Math.max(1,deadline-io.now())));
    req.on('close',()=>clearTimeout(timer)); req.on('error',()=>reject(new Error('Push delivery outcome unknown.'))); req.end();
  });
}
