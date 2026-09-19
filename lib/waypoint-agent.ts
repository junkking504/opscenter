import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import type {HierarchyFeed, HierarchyFinding} from '../desktop-ui/lib/agent-hierarchy-contract';
import {crewPhoneDeliveryHealth} from './crew-phone-delivery';

const owner = 'waypoint';
const monitor = '/desktop?data=live&workspace=Command&commandView=monitor';
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
type Probe = {status: number; body: string};
type Check = {id: string; route: string; accepts: (value: Probe) => boolean};
export const waypointChecks: Check[] = [
  {id:'page', route:'/crew-jobs', accepts:r=>r.status===200 && r.body.includes('Waypoint') && r.body.includes('waypoint-favicon')},
  {id:'manifest', route:'/crew-jobs/manifest.webmanifest', accepts:r=>{
    try {const m=JSON.parse(r.body);return r.status===200 && m.name==='Waypoint' && m.start_url==='/crew-jobs';}catch{return false;}
  }},
  ...['session','day','inspection','current','switch-truck','closeout'].map(id=>({id,route:`/api/crew-jobs/${id}`,accepts:(r:Probe)=>{
    try {return r.status===401 && JSON.parse(r.body).error==='This phone needs manager setup.';}catch{return false;}
  }})),
];

/** Fixed loopback GETs only: no cookies, vendor calls, redirects or source actions. */
export function probeWaypoint(route:string):Promise<Probe> {
  if(!waypointChecks.some(c=>c.route===route))return Promise.reject(new Error('Unknown check'));
  return new Promise((resolve,reject)=>{
    const request=http.get({hostname:'127.0.0.1',port:3000,path:route,headers:{Host:'waypoint.junk-king.app','X-Forwarded-Proto':'https','X-Forwarded-Host':'waypoint.junk-king.app','Cache-Control':'no-cache'}},response=>{
      const parts:Buffer[]=[];let size=0;
      response.on('data',(chunk:Buffer)=>{size+=chunk.length;if(size>1024*1024)request.destroy(new Error('Response too large'));else parts.push(chunk);});
      response.on('end',()=>resolve({status:response.statusCode||0,body:Buffer.concat(parts).toString('utf8')}));
      response.on('error',reject);
    });
    const timer=setTimeout(()=>request.destroy(new Error('Check timed out')),3000);
    request.on('error',reject);request.on('close',()=>clearTimeout(timer));
  });
}

function finding(feed:string,id:string,title:string,detail:string,href=monitor):HierarchyFinding {
  return {id:`waypoint:${id}`,feed,title,detail,href,origin:owner,target:owner,priority:'urgent'};
}
function unavailable(id:string,detail:string):HierarchyFeed {
  return {id,available:false,observedAt:null,detail,findings:[finding(id,`coverage:${id}`,'Waypoint monitoring evidence unavailable',detail)]};
}
export async function waypointRouteFeeds(now:number,probe:(route:string)=>Promise<Probe>=probeWaypoint):Promise<HierarchyFeed[]> {
  return Promise.all(waypointChecks.map(async check=>{
    const id=`waypoint-${check.id}`;
    try {
      const result=await probe(check.route),ok=check.accepts(result);
      return {id,available:true,observedAt:new Date(now).toISOString(),detail:`Local Waypoint host ${check.route}: HTTP ${result.status}. ${ok?'Expected response confirmed.':'Unexpected response; engineering review required.'} Public DNS/tunnel and authenticated crew interactions are separate checks.`,
        findings:ok?[]:[finding(id,`route:${check.id}`,`Waypoint ${check.id} check failed`,`Local ${check.route} returned HTTP ${result.status} with an unexpected response. Check the active release, service and route; verify the actual crew interaction before closing the engineering repair.`)]};
    }catch{return unavailable(id,`Local Waypoint ${check.route} could not be checked within its bounded request. Check the service and active release; prior findings remain unconfirmed.`);}
  }));
}

type RecordRow = Record<string,unknown>;
function records(directory:string,root:string):RecordRow[] {
  // An absent optional ledger is normal before first use; a missing data mount is not.
  if(!fs.statSync(root).isDirectory())throw new Error('Data root unavailable');
  let names:string[];
  try {names=fs.readdirSync(directory).filter(n=>n.endsWith('.json'));}
  catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return [];throw error;}
  if(names.length>10_000)throw new Error('Ledger exceeds monitoring bound');
  return names.map(name=>{
    if(!uuid.test(name.slice(0,-5)))throw new Error('Invalid receipt name');
    const file=path.join(directory,name);
    if(fs.statSync(file).size>2*1024*1024)throw new Error('Receipt exceeds monitoring bound');
    const row=JSON.parse(fs.readFileSync(file,'utf8')) as RecordRow;
    if(!row || row.requestId!==name.slice(0,-5) || typeof row.status!=='string' || typeof row.updatedAt!=='string' || !Number.isFinite(Date.parse(row.updatedAt)))throw new Error('Invalid receipt');
    return row;
  });
}
export function waypointLedgerFeeds(root:string,now:number,phoneRoot=path.join(root,'crew-phones'),receiptRoot=path.join(root,'desktop-operations')):HierarchyFeed[] {
  const feeds:HierarchyFeed[]=[];
  for(const kind of ['switches','closeouts'] as const) {
    const id=`waypoint-${kind}`;
    try {
      const rows=records(kind==='switches'?path.join(phoneRoot,'truck-switches'):receiptRoot,root);
      const findings:HierarchyFinding[]=[];
      for(const row of rows) {
        if(kind==='closeouts' && (row.action!=='closeout' || typeof row.actor!=='string' || !row.actor.startsWith('crew-phone:')))continue;
        if(kind==='switches' && (row.schema!==1 || !['moving','attention','complete'].includes(String(row.status))))throw new Error('Invalid switch status');
        if(kind==='closeouts' && !['pending','uncertain','verified','failed','reconciled'].includes(String(row.status)))throw new Error('Invalid closeout status');
        const elapsed=now-Date.parse(String(row.updatedAt));
        if(elapsed< -60_000)throw new Error('Receipt timestamp is in the future');
        const stalled=kind==='switches' ? row.status==='attention' || (row.status==='moving' && elapsed>5*60_000) : row.status==='uncertain' || (row.status==='pending' && elapsed>10*60_000);
        if(!stalled)continue;
        findings.push(finding(id,`${kind}:${row.requestId}`,kind==='switches'?'Waypoint truck switch needs recovery':'Waypoint closeout needs source verification',
          `Saved reference ${row.requestId}; last updated ${row.updatedAt}. ${kind==='switches'?'Open Switch truck on the assigned phone and use Check saved switch. Both trucks remain reserved until verified.':'Open the saved closeout result and verify the source before another change or payment.'} The agent does not retry writes.`,
          kind==='switches'?'/crew-phones':'/desktop?data=live&workspace=Control&controlView=board'));
      }
      feeds.push({id,available:true,observedAt:new Date(now).toISOString(),detail:`Read ${rows.length} saved ${kind==='switches'?'truck switches':'schedule receipts'}; ${findings.length} unresolved Waypoint exceptions. All dates included; normal inspection gates and idle phones are not outages.`,findings});
    }catch {feeds.push(unavailable(id,`Waypoint ${kind} history could not be read completely. Preserve receipts and investigate storage; prior findings cannot clear.`));}
  }
  return feeds;
}
export async function readWaypointFeeds(root:string,now:number):Promise<HierarchyFeed[]> {
  const routes=process.env.OPSCENTER_RUNTIME==='MISSION_CONTROL' ? await waypointRouteFeeds(now) : waypointChecks.map(c=>unavailable(`waypoint-${c.id}`,'Production loopback checks are disabled outside the Mission Control runtime.'));
  return [...routes,...waypointLedgerFeeds(root,now,process.env.OPS_CREW_PHONE_DIR,process.env.OPSCENTER_DESKTOP_OPERATIONS_DIR),waypointDeliveryFeed(now)];
}

export function waypointDeliveryFeed(now:number,read=crewPhoneDeliveryHealth):HierarchyFeed {
  const id='waypoint-delivery';
  try {
    const health=read(now);
    return {id,available:true,observedAt:new Date(now).toISOString(),detail:health.reason,findings:[
      ...(!health.ready?[finding(id,'delivery-unavailable','Waypoint setup-code delivery needs attention',`${health.reason} Review Company Phones and existing approval; do not raise spending limits automatically.`,'/crew-phones')]:[]),
      ...health.exceptions.map(r=>finding(id,`delivery:${r.requestId}`,'Waypoint setup message needs verification',`Saved send ${r.requestId} is ${r.status} since ${r.createdAt}. Check the phone and saved send status in Company Phones. Do not replay an uncertain send.`,'/crew-phones')),
    ]};
  }catch{return unavailable(id,'Setup-delivery receipt history could not be read completely; preserve saved sends and review Company Phones.');}
}
