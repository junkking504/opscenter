import fs from 'node:fs';
import path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import type {StreetRoute,TruckGpsRoute} from '../desktop-ui/lib/gps-route-contract';

export type SavedStreetProgress={source:TruckGpsRoute;result:StreetRoute & {nextEdge?:number};retryAt:number};
const ttl=7*24*60*60_000,maxBytes=8*1024*1024;
const hash=(value:string)=>createHash('sha256').update(value).digest('hex');
export const streetRouteCacheDirectory=()=>path.join(process.env.OPSCENTER_DATA_DIR || process.env.OPSBOT_DATA_DIR || path.join(process.cwd(),'data'),'cache','street-routes-v1');
const filename=(directory:string,date:string,truck:string)=>path.join(directory,`${hash(`${date}:${truck}`)}.json`);

export function loadStreetProgress(directory:string,date:string,truck:string,now=Date.now()):SavedStreetProgress|undefined {
  try {
    const file=filename(directory,date,truck),stat=fs.statSync(file);
    if(stat.size>maxBytes || now-stat.mtimeMs>ttl)return;
    const envelope=JSON.parse(fs.readFileSync(file,'utf8'));
    if(envelope.version!==1 || typeof envelope.payload!=='string' || hash(envelope.payload)!==envelope.checksum)return;
    const saved=JSON.parse(envelope.payload) as SavedStreetProgress;
    if(saved.source?.date!==date || saved.source?.truck!==truck || !Array.isArray(saved.source.points) || !Array.isArray(saved.result?.paths) || !Number.isFinite(saved.retryAt))return;
    const coordinate=(p:{latitude:number;longitude:number})=>p && Number.isFinite(p.latitude) && Math.abs(p.latitude)<=90 && Number.isFinite(p.longitude) && Math.abs(p.longitude)<=180;
    if(!saved.source.points.every(p=>coordinate(p) && Number.isFinite(Date.parse(p.timestamp))))return;
    if(!saved.result.paths.every(p=>Number.isInteger(p.sourceEdge) && p.sourceEdge!>=0 && p.sourceEdge!+1<saved.source.points.length && ['matched','estimated'].includes(p.kind) && Array.isArray(p.points) && p.points.length>=2 && p.points.every(coordinate)))return;
    return saved;
  } catch {return;}
}

export function saveStreetProgress(directory:string,saved:SavedStreetProgress,now=Date.now()) {
  let temporary='';
  try {
    // Store only GPS provenance and road geometry; no trip addresses or crew data.
    const source={...saved.source,trips:undefined,streets:undefined};
    const payload=JSON.stringify({...saved,source});
    const data=JSON.stringify({version:1,checksum:hash(payload),payload});
    if(Buffer.byteLength(data)>maxBytes)return;
    fs.mkdirSync(directory,{recursive:true,mode:0o700});
    const destination=filename(directory,source.date,source.truck);
    temporary=`${destination}.${randomUUID()}.tmp`;
    fs.writeFileSync(temporary,data,{mode:0o600,flag:'wx'});
    fs.renameSync(temporary,destination);temporary='';
    const files=fs.readdirSync(directory).filter(name=>/^[a-f0-9]{64}\.json$/.test(name)).map(name=>({file:path.join(directory,name),mtime:fs.statSync(path.join(directory,name)).mtimeMs})).sort((a,b)=>b.mtime-a.mtime);
    for(const [index,file] of files.entries())if(index>=32 || now-file.mtime>ttl)fs.unlinkSync(file.file);
  } catch { /* Cache failure cannot interrupt GPS or source reads. */ }
  finally {if(temporary)try{fs.unlinkSync(temporary);}catch{ /* Best effort cache cleanup. */ }}
}
