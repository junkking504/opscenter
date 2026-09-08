import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import type {OperationalAlert} from './operational-alert-presentation';
import type {TruckLoadEvent} from './truck-load-status';

type SourceRow = Record<string, unknown>;
export type GeofenceEntry = {
  id: string; truck: string; name: string; facility: string; timestamp: string;
  resetLocation: 'dump' | 'metal_yard' | null;
};

export function geofenceFacility(name: string): Pick<GeofenceEntry, 'facility' | 'resetLocation'> {
  // Warehouse entry is informational: it never establishes an empty truck.
  if (/warehouse|\b(?:NOHQ|BRHQ)\b|junk[ -]*king.*(?:yard|hq)/i.test(name)) return {facility:'Junk King warehouse',resetLocation:null};
  if (/transfer|stranco|green meadow|mengel|^(?:STS|GMTS)$/i.test(name)) return {facility:'Transfer station',resetLocation:'dump'};
  if (/landfill|gentilly|river\s*birch|^dump$|^(?:GL|RBL|BRL)$/i.test(name)) return {facility:'Landfill',resetLocation:'dump'};
  if (/\bEMR\b|scrap|metal.*(?:recycl|yard)|recycl.*metal/i.test(name)) return {facility:'Metal recycling yard',resetLocation:'metal_yard'};
  return {facility:'Geofenced area',resetLocation:null};
}

export function geofenceEntries(date: string, rows: SourceRow[], now = Date.now()): GeofenceEntry[] {
  const entries = new Map<string,GeofenceEntry>();
  for (const row of rows) {
    if (![row.alert_type,row.alert_type_normalized].some(value => /^geofence_entered$/i.test(String(value || '')))) continue;
    const name = String(row.geofence_name || '').trim();
    const match = String(row.truck_number || row.vehicle_name || '').trim().match(/^(?:truck\s*#?\s*|t\s*|#\s*)?(\d+)$/i);
    const time = Date.parse(String(row.occurred_at || ''));
    if (!name || !match || Number(match[1]) < 1 || !Number.isFinite(time) || time > now) continue;
    const timestamp = new Date(time).toISOString();
    const localDate = new Intl.DateTimeFormat('en-CA',{timeZone:'America/Chicago',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(time));
    if (localDate !== date) continue;
    const truck = `Truck ${Number(match[1])}`;
    // Provider retries do not create another entry/reset; real reentries at
    // different times remain distinct. No stop/ignition row invents an entry.
    const id = `linxup-geofence-${createHash('sha256').update(JSON.stringify([truck,name.toLowerCase(),timestamp])).digest('hex').slice(0,32)}`;
    entries.set(id,{id,truck,name,timestamp,...geofenceFacility(name)});
  }
  return [...entries.values()].sort((a,b)=>b.timestamp.localeCompare(a.timestamp));
}

export function readGeofenceEntries(date: string) {
  const unavailable = {entries:[] as GeofenceEntry[],visits:[] as GeofenceVisit[],available:false,complete:false,observedAt:''};
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return unavailable;
  const root = process.env.OPSCENTER_DATA_DIR || process.env.OPSBOT_DATA_DIR || path.join(process.cwd(),'data');
  try {
    const data = JSON.parse(fs.readFileSync(path.join(root,'history','linxup','alerts',`linxup_alerts_${date}.json`),'utf8'));
    if (data.date !== date || !Array.isArray(data.alerts)) return unavailable;
    const previousDate=new Date(Date.parse(date+'T12:00:00Z')-86_400_000).toISOString().slice(0,10);
    let previous:SourceRow[]=[];
    try{
      const prior=JSON.parse(fs.readFileSync(path.join(root,'history','linxup','alerts',`linxup_alerts_${previousDate}.json`),'utf8'));
      if(prior.date===previousDate && Array.isArray(prior.alerts))previous=prior.alerts;
    }catch{ /* Missing entry history leaves departure duration unavailable. */ }
    return {entries:geofenceEntries(date,data.alerts),visits:geofenceVisits(date,[...previous,...data.alerts]),available:true,complete:data.pagination_completed === true && data.validation_status === 'passed',observedAt:String(data.collection_timestamp || '')};
  } catch { return unavailable; }
}

export function geofenceOperationalAlert(entry: GeofenceEntry, date: string): OperationalAlert {
  const detected = new Intl.DateTimeFormat('en-US',{timeZone:'America/Chicago',hour:'numeric',minute:'2-digit'}).format(new Date(entry.timestamp));
  return {id:entry.id,timestamp:entry.timestamp,label:'Geofence Entry',source:'LinxUp',domain:'Fleet',truck:entry.truck,
    detected,title:`${entry.truck} · ${entry.name}`,owner:'Fleet',needsAction:false,
    facts:[{label:'Location',value:entry.name},{label:'Facility',value:entry.facility},{label:'Entered',value:detected},
      {label:'Truck load',value:entry.resetLocation ? 'Reset to empty on entry' : 'Unchanged'}],
    next:entry.resetLocation ? 'Truck assumed empty on entry. Later completed jobs add to the load.' : 'Location update only; truck load is unchanged.',
    href:`/desktop?workspace=Fleet&date=${encodeURIComponent(date)}&truck=${encodeURIComponent(entry.truck.replace('Truck ','Truck# '))}`};
}

export function geofenceLoadResets(date: string, entries: GeofenceEntry[]): TruckLoadEvent[] {
  return entries.flatMap(entry=>entry.resetLocation ? [{
    eventId:entry.id,date,truck:entry.truck.replace('Truck ','Truck# '),kind:'yard_reset' as const,loadFraction:0,
    occurredAt:entry.timestamp,recordedAt:entry.timestamp,recordedBy:`Automatic geofence entry: ${entry.name}`,
    appointmentId:'',jobNumber:'',loadSize:'',loadQuantity:'',contents:'',resetLocation:entry.resetLocation,
  }] : []);
}

export type GeofenceVisit = {
  id:string; truck:string; name:string; enteredAt:string|null; departedAt:string;
  durationSeconds:number|null; entryIds:string[];
};

/** Pair source transitions, never stops or inferred positions. */
export function geofenceVisits(date:string,rows:SourceRow[],now=Date.now()):GeofenceVisit[] {
  type Transition={truck:string;name:string;timestamp:string;type:'entry'|'exit';id:string};
  const events=new Map<string,Transition>();
  for(const row of rows){
    const values=[row.alert_type,row.alert_type_normalized].map(v=>String(v || '').toLowerCase());
    const type=values.includes('geofence_entered')?'entry':values.includes('geofence_exited')?'exit':null;
    if(!type)continue;
    const time=Date.parse(String(row.occurred_at || ''));
    if(!Number.isFinite(time) || time>now)continue;
    const day=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Chicago',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(time));
    // Reuse strict truck/name validation and the existing entry identity.
    const entry=geofenceEntries(day,[{...row,alert_type:'GEOFENCE_ENTERED'}],now)[0];
    if(!entry)continue;
    events.set(`${type}:${entry.id}`,{truck:entry.truck,name:entry.name,timestamp:entry.timestamp,type,id:entry.id});
  }
  const active=new Map<string,{entry:Transition;ambiguous:boolean;entryIds:string[]}>(),visits:GeofenceVisit[]=[];
  const ordered=[...events.values()].sort((a,b)=>a.timestamp.localeCompare(b.timestamp) || a.type.localeCompare(b.type));
  for(const event of ordered){
    const key=JSON.stringify([event.truck,event.name.toLowerCase()]);
    if(event.type==='entry'){
      const previous=active.get(key);
      active.set(key,{entry:previous?.entry || event,ambiguous:!!previous,entryIds:[...(previous?.entryIds || []),event.id]});
      continue;
    }
    const pending=active.get(key);active.delete(key);
    const day=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Chicago',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(event.timestamp));
    if(day!==date)continue;
    const enteredAt=pending && !pending.ambiguous?pending.entry.timestamp:null;
    const seconds=enteredAt?(Date.parse(event.timestamp)-Date.parse(enteredAt))/1000:null;
    visits.push({id:pending?.entry.id || event.id.replace('linxup-geofence-','linxup-geofence-exit-'),truck:event.truck,name:event.name,enteredAt,departedAt:event.timestamp,durationSeconds:seconds!==null && seconds>=0?seconds:null,entryIds:pending?.entryIds || []});
  }
  return visits.sort((a,b)=>b.departedAt.localeCompare(a.departedAt));
}

const siteDuration=(seconds:number)=>{
  const hours=Math.floor(seconds/3600),minutes=Math.floor(seconds%3600/60),remaining=Math.floor(seconds%60);
  return [hours?`${hours}h`:'',minutes?`${minutes}m`:'',remaining || (!hours && !minutes)?`${remaining}s`:''].filter(Boolean).join(' ');
};
export function geofenceVisitAlert(visit:GeofenceVisit,date:string):OperationalAlert {
  const time=(stamp:string)=>new Intl.DateTimeFormat('en-US',{timeZone:'America/Chicago',month:'short',day:'numeric',hour:'numeric',minute:'2-digit',second:'2-digit'}).format(new Date(stamp));
  return {id:visit.id,timestamp:visit.departedAt,label:'Site Visit Completed',source:'LinxUp',domain:'Fleet',truck:visit.truck,
    detected:new Intl.DateTimeFormat('en-US',{timeZone:'America/Chicago',hour:'numeric',minute:'2-digit'}).format(new Date(visit.departedAt)),
    title:`${visit.truck} · ${visit.name}`,owner:'Fleet',needsAction:false,
    facts:[{label:'Time on site',value:visit.durationSeconds===null?'Unavailable · entry not confirmed':siteDuration(visit.durationSeconds)},
      {label:'Arrived',value:visit.enteredAt?time(visit.enteredAt):'Entry not confirmed'},
      {label:'Departed',value:time(visit.departedAt)},{label:'Location',value:visit.name}],
    next:visit.durationSeconds===null?'Departure recorded; a matching entry is unavailable or ambiguous.':'Completed visit duration from LinxUp entry and exit events.',
    href:`/desktop?workspace=Fleet&date=${encodeURIComponent(date)}&truck=${encodeURIComponent(visit.truck.replace('Truck ','Truck# '))}`};
}

export function geofenceTimelineAlerts(date:string,entries:GeofenceEntry[],visits:GeofenceVisit[]):OperationalAlert[]{
  const completed=new Set(visits.flatMap(visit=>visit.entryIds));
  return [...entries.filter(entry=>!completed.has(entry.id)).map(entry=>geofenceOperationalAlert(entry,date)),...visits.map(visit=>geofenceVisitAlert(visit,date))];
}
