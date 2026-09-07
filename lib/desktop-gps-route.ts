import fs from 'node:fs';
import path from 'node:path';
import {chicagoDateKey} from './chicago-date';
import {splitPlausibleRouteRuns} from './job-route-history';
import type {GpsRoutePoint,TruckGpsRoute} from '../desktop-ui/lib/gps-route-contract';

const label=(value:unknown)=>{const match=String(value || '').trim().match(/^(?:truck\s*#?\s*|t\s*|#\s*)?([1-9]\d{0,2})$/i);return match?`Truck ${Number(match[1])}`:null;};
export const gpsRouteTruck=label;
export function gpsRouteDate(value:string) {return /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value+'T12:00:00Z')) && new Date(value+'T12:00:00Z').toISOString().slice(0,10)===value;}
const stamp=(value:unknown)=>typeof value==='string' && /T.*(?:Z|[+-]\d{2}:\d{2})$/i.test(value) && Number.isFinite(Date.parse(value))?Date.parse(value):NaN;
const coordinate=(value:unknown)=>typeof value==='number'?value:typeof value==='string' && value.trim()?Number(value):NaN;

/** GPS evidence is independent of appointments, assignments and daily payroll. */
export function normalizeTruckGpsRoute(payload:unknown,date:string,truck:string,now=Date.now()):TruckGpsRoute {
  const empty:TruckGpsRoute={date,truck,status:'unavailable',observedAt:null,coveredThrough:null,points:[],paths:[],gaps:0,rejected:0};
  if(!payload || typeof payload!=='object' || !Array.isArray((payload as {points?:unknown}).points)) return empty;
  const source=payload as {points:unknown[];collection_timestamp?:unknown};
  const collected=stamp(source.collection_timestamp);
  const observedAt=Number.isFinite(collected) && collected<=now?new Date(collected).toISOString():null;
  const observations:Array<GpsRoutePoint & {until:number}>=[];
  let rejected=0;
  const seen=new Map<string,GpsRoutePoint & {until:number}>();
  for(const raw of source.points) {
    if(!raw || typeof raw!=='object') continue;
    const row=raw as Record<string,unknown>;
    if(label(row.truck_number || row.truck || row.truckNumber)!==truck) continue;
    const time=stamp(row.timestamp),latitude=coordinate(row.latitude),longitude=coordinate(row.longitude);
    if(!Number.isFinite(time) || time>now || !Number.isFinite(latitude) || !Number.isFinite(longitude) || Math.abs(latitude)>90 || Math.abs(longitude)>180 || latitude===0 && longitude===0) {rejected++;continue;}
    // Daily files can include a last-known point from a previous date. It must
    // never appear as travel on the selected Central operating date.
    if(chicagoDateKey(new Date(time))!==date) continue;
    const timestamp=new Date(time).toISOString();
    const key=`${timestamp}:${latitude}:${longitude}`;
    const continuous=stamp(row.continuous_until);
    const until=Number.isFinite(continuous) && continuous>=time && continuous<=now && chicagoDateKey(new Date(continuous))===date?continuous:time;
    const duplicate=seen.get(key);
    if(duplicate) {duplicate.until=Math.max(duplicate.until,until);continue;}
    const point={timestamp,latitude,longitude,until};seen.set(key,point);observations.push(point);
  }
  observations.sort((a,b)=>Date.parse(a.timestamp)-Date.parse(b.timestamp));
  // Do not imply a road traveled during an observation gap. Compression of a
  // stationary observation preserves its recorded coverage through `until`.
  const chunks:typeof observations[]=[];
  for(const point of observations) {
    const current=chunks.at(-1),previous=current?.at(-1);
    const transitionStart=previous?Math.min(previous.until,Date.parse(point.timestamp)):0;
    const gap=previous && (Date.parse(point.timestamp)-previous.until>5*60_000 || splitPlausibleRouteRuns([{...previous,timestamp:new Date(transitionStart).toISOString()},point]).length>1);
    if(!current || gap) chunks.push([point]);
    else current.push(point);
  }
  const runs=chunks;
  const clean=({timestamp,latitude,longitude}:GpsRoutePoint):GpsRoutePoint=>({timestamp,latitude,longitude});
  const coveredThrough=observations.length?new Date(Math.max(...observations.map(point=>point.until))).toISOString():null;
  return {date,truck,status:observations.length?'available':'empty',observedAt,coveredThrough,points:observations.map(clean),paths:runs.filter(run=>run.length>1).map(run=>run.map(clean)),gaps:Math.max(0,runs.length-1),rejected};
}

export function readTruckGpsRoute(date:string,truck:string,root=process.env.OPSCENTER_DATA_DIR || process.env.OPSBOT_DATA_DIR || path.join(process.cwd(),'data'),now=Date.now()):TruckGpsRoute {
  if(!gpsRouteDate(date) || gpsRouteTruck(truck)!==truck) throw new Error('Invalid GPS route selection');
  let payload:unknown=null;
  try {payload=JSON.parse(fs.readFileSync(path.join(root,'history','linxup',`linxup_location_${date}.json`),'utf8'));} catch { /* Missing or unreadable source stays unavailable. */ }
  return normalizeTruckGpsRoute(payload,date,truck,now);
}
