import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import type {OperationalAlert} from './operational-alert-presentation';
import type {TruckLoadEvent} from './truck-load-status';
import {geofenceOnsiteSummary} from './geofence-alert-summary';
import {trackGeofenceVisits, visitDay, type GeofenceTransition, type TrackedVisit} from './visit-tracking-agent';

type SourceRow = Record<string, unknown>;
export type GeofenceEntry = {
  id: string; truck: string; name: string; facility: string; timestamp: string;
  resetLocation: 'dump' | 'metal_yard' | null;
  positionObserved?: boolean;
};

export function geofenceFacility(name: string): Pick<GeofenceEntry, 'facility' | 'resetLocation'> {
  // Warehouse entry is informational: it never establishes an empty truck.
  if (/warehouse|\b(?:NOHQ|BRHQ)\b|junk[ -]*king.*(?:yard|hq)/i.test(name)) return {facility:'Junk King warehouse',resetLocation:null};
  if (/transfer|stranco|green meadow|mengel|^(?:STS|GMTS)$/i.test(name)) return {facility:'Transfer station',resetLocation:'dump'};
  if (/landfill|gentilly|river\s*birch|\bdump\b|^(?:GL|RBL|BRL|EBR)$/i.test(name)) return {facility:'Landfill',resetLocation:'dump'};
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

/** Strict provider normalization shared by the ongoing visit-tracking agent. */
export function trackedGeofenceVisits(date: string, observations: SourceRow[], sourceRows: SourceRow[], now = Date.now()): TrackedVisit[] {
  const transitions: GeofenceTransition[] = [];
  for (const {row, position} of [...sourceRows.map(row=>({row,position:false})), ...observations.map(row=>({row,position:true}))]) {
    const values = [row.alert_type,row.alert_type_normalized].map(value=>String(value || '').toLowerCase());
    const type = position ? 'position' : values.includes('geofence_entered') ? 'entry' : values.includes('geofence_exited') ? 'exit' : null;
    const stamp = Date.parse(String(row.occurred_at || ''));
    if (!type || !Number.isFinite(stamp) || stamp > now) continue;
    const entry = geofenceEntries(visitDay(new Date(stamp).toISOString()), [{...row,alert_type:'geofence_entered'}], now)[0];
    if (entry) transitions.push({...entry,type});
  }
  return trackGeofenceVisits(date,transitions,now);
}

/** Compatibility arrival adapter. Downstream business effects consume trackedVisits. */
export function geofencePositionArrivals(date: string, observations: SourceRow[], sourceRows: SourceRow[], now = Date.now()): GeofenceEntry[] {
  const nativeIds = new Set(geofenceEntries(date,sourceRows,now).map(entry=>entry.id));
  return trackedGeofenceVisits(date,observations,sourceRows,now).filter(visit=>!visit.departedAt && visit.enteredAt && !visit.entryIds.some(id=>nativeIds.has(id)))
    .map(visit=>({id:visit.id,truck:visit.truck,name:visit.name,timestamp:visit.enteredAt!,facility:visit.facility!,resetLocation:null,positionObserved:true}));
}

export function readGeofenceEntries(date: string) {
  const unavailable = {entries:[] as GeofenceEntry[],arrivals:[] as GeofenceEntry[],visits:[] as GeofenceVisit[],trackedVisits:[] as TrackedVisit[],sourceHealth:{alerts:'missing',alertsObservedAt:'',positionsObservedAt:''},available:false,complete:false,observedAt:''};
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return unavailable;
  const root = process.env.OPSCENTER_DATA_DIR || process.env.OPSBOT_DATA_DIR || path.join(process.cwd(),'data');
  try {
    let data: SourceRow = {};
    try { data = JSON.parse(fs.readFileSync(path.join(root,'history','linxup','alerts',`linxup_alerts_${date}.json`),'utf8')); } catch { /* V3 arrivals remain available independently. */ }
    const available = data.date === date && Array.isArray(data.alerts);
    const rows: SourceRow[] = available ? data.alerts as SourceRow[] : [];
    const previousDate=new Date(Date.parse(date+'T12:00:00Z')-86_400_000).toISOString().slice(0,10);
    let previous:SourceRow[]=[];
    try{
      const prior=JSON.parse(fs.readFileSync(path.join(root,'history','linxup','alerts',`linxup_alerts_${previousDate}.json`),'utf8'));
      if(prior.date===previousDate && Array.isArray(prior.alerts))previous=prior.alerts;
    }catch{ /* Missing entry history leaves departure duration unavailable. */ }
    let observations: SourceRow[] = [];
    for (const day of [previousDate, date]) {
      try {
        const positions = JSON.parse(fs.readFileSync(path.join(root,'history','linxup','geofence_positions',`${day}.json`),'utf8'));
        if (positions.date === day && Array.isArray(positions.observations)) observations.push(...positions.observations);
      } catch { /* Position observations supplement the existing alert feed. */ }
    }
    const entries = geofenceEntries(date, rows);
    const trackedVisits = trackedGeofenceVisits(date,observations,[...previous,...rows]);
    const arrivals: GeofenceEntry[] = trackedVisits.filter(visit=>!visit.departedAt).map(visit=>({
      id:visit.id,truck:visit.truck,name:visit.name,timestamp:visit.firstObservedAt,facility:visit.facility!,
      resetLocation:null,positionObserved:visit.arrivalSource === 'live_position'}));
    const visits: GeofenceVisit[] = trackedVisits.filter(visit=>!!visit.departedAt).map(visit=>({...visit,departedAt:visit.departedAt!}));
    let status: SourceRow = {};
    try { status = JSON.parse(fs.readFileSync(path.join(root,'history','linxup','alerts',`linxup_alerts_${date}_status.json`),'utf8')); } catch { /* Legacy snapshots have no attempt status. */ }
    const observedAt = String(data.collection_timestamp || '');
    const failed = status.date === date && (status.source_status === 'failed' || status.validation_status === 'failed');
    const stale = date === visitDay(new Date().toISOString()) && (!Number.isFinite(Date.parse(observedAt)) || Date.now()-Date.parse(observedAt) > 30*60*1000);
    const positionsObservedAt = observations.map(row=>String(row.occurred_at || '')).filter(stamp=>Number.isFinite(Date.parse(stamp)) && Date.parse(stamp)<=Date.now()).sort().at(-1) || '';
    return {entries,arrivals,visits,trackedVisits,available,
      complete:available && !failed && !stale && data.pagination_completed === true && data.validation_status === 'passed',observedAt,
      sourceHealth:{alerts:failed ? 'failed' : stale ? 'stale' : available ? 'available' : 'missing',alertsObservedAt:observedAt,positionsObservedAt}};
  } catch { return unavailable; }
}

export function geofenceOperationalAlert(entry: GeofenceEntry, date: string): OperationalAlert {
  const detected = new Intl.DateTimeFormat('en-US',{timeZone:'America/Chicago',hour:'numeric',minute:'2-digit'}).format(new Date(entry.timestamp));
  return {id:entry.id,timestamp:entry.timestamp,label:'Geofence',source:'LinxUp',domain:'Fleet',truck:entry.truck,
    detected,title:`${entry.truck} - ${entry.name}`,owner:'Fleet',needsAction:false,
    facts:[{label:'Onsite',value:geofenceOnsiteSummary('Pending',entry.timestamp,null)},
      {label:'Location',value:entry.name},{label:'Facility',value:entry.facility},{label:'Entered',value:detected},
      ...(entry.positionObserved ? [{label:'Arrival source',value:'Live GPS facility report'}] : []),
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
  departureSource?: TrackedVisit['departureSource']; departureBounds?: TrackedVisit['departureBounds']; arrivalSource?: TrackedVisit['arrivalSource'];
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
  const bounds = visit.departureBounds;
  const duration=bounds ? 'Departure time bounded by GPS' : visit.durationSeconds===null?'Unavailable · entry not confirmed':`${visit.arrivalSource === 'live_position' ? 'At least ' : ''}${siteDuration(visit.durationSeconds)}`;
  return {id:visit.id,timestamp:visit.departedAt,label:'Geofence',source:'LinxUp',domain:'Fleet',truck:visit.truck,
    detected:new Intl.DateTimeFormat('en-US',{timeZone:'America/Chicago',hour:'numeric',minute:'2-digit'}).format(new Date(visit.departedAt)),
    title:`${visit.truck} - ${visit.name}`,owner:'Fleet',needsAction:false,
    facts:[{label:'Onsite',value:bounds ? `${duration} | after ${time(bounds.after)} · by ${time(bounds.by)}` : geofenceOnsiteSummary(duration,visit.enteredAt,visit.departedAt)},
      {label:'Time on site',value:duration},
      {label:'Arrived',value:visit.enteredAt?time(visit.enteredAt):'Entry not confirmed'},
      {label:'Departed',value:bounds ? `After ${time(bounds.after)} · by ${time(bounds.by)}` : time(visit.departedAt)},{label:'Location',value:visit.name},
      ...(bounds ? [{label:'Departure source',value:'Later positive GPS report at another facility; exact exit time unavailable'}] : []),
      ...(visit.arrivalSource === 'live_position' ? [{label:'Arrival source',value:'First positive live GPS facility report'}] : [])],
    next:bounds ? 'Departure established by a later facility report. Exit time is between the last onsite report and the later facility report.' : visit.durationSeconds===null?'Departure recorded; a matching entry is unavailable or ambiguous.':visit.arrivalSource === 'live_position' ? 'Observed onsite time from the first live facility report through the native exit; exact arrival time is unavailable.' : 'Completed visit duration from LinxUp entry and exit events.',
    href:`/desktop?workspace=Fleet&date=${encodeURIComponent(date)}&truck=${encodeURIComponent(visit.truck.replace('Truck ','Truck# '))}`};
}

export function geofenceTimelineAlerts(date:string,entries:GeofenceEntry[],visits:GeofenceVisit[]):OperationalAlert[]{
  const completed=new Set(visits.flatMap(visit=>visit.entryIds));
  return [...entries.filter(entry=>!completed.has(entry.id)).map(entry=>geofenceOperationalAlert(entry,date)),...visits.map(visit=>geofenceVisitAlert(visit,date))];
}
