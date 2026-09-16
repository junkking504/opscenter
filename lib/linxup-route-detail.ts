import fs from 'node:fs';
import path from 'node:path';

type Row=Record<string,unknown>;
const cache=new Map<string,{version:string;payload:Row}>();

/** The provider batches earlier fixes with its latest position. These fixes
 * carry their own time/coordinates; they do not inherit ignition or stop time. */
export function batchedRoutePositions(payload:Row,parent:Row):Row[] {
  const end=Number(payload.date ?? payload.positionDate);
  if(!Number.isFinite(end) || end!==Date.parse(String(parent.timestamp)))return [];
  if(Number(payload.latitude)!==Number(parent.latitude) || Number(payload.longitude)!==Number(parent.longitude))return [];
  const text=payload.batchedPositions;
  if(typeof text!=='string' || text.length>512_000)return [];
  const points:Row[]=[];
  for(const entry of text.split(';').slice(0,8192)) {
    const fields=entry.split(',');
    if(fields.length!==4 || fields.some(value=>!value.trim()))continue;
    const [time,latitude,longitude,speed]=fields.map(Number);
    if(![time,latitude,longitude,speed].every(Number.isFinite) || time<=0 || time>=end || end-time>86_400_000
      || Math.abs(latitude)>90 || Math.abs(longitude)>180 || latitude===0 && longitude===0 || speed<0 || speed>150)continue;
    points.push({timestamp:new Date(time).toISOString(),latitude,longitude,truck_number:parent.truck_number,
      tracker_id:parent.tracker_id,delivery_source:'v3_position_batch'});
  }
  return points;
}

/** Read only the durable envelopes identified by the normalized truck history.
 * A bounded cache avoids rereading every report on each viewer poll. */
export function withLinxupRouteDetail(payload:unknown,date:string,truck:string,root:string):unknown {
  if(!payload || typeof payload!=='object' || !Array.isArray((payload as Row).points))return payload;
  const source=payload as Row,points=source.points as Row[],detail:Row[]=[];
  for(const parent of points) {
    if(!parent || parent.delivery_source!=='v3_position_push' || parent.truck_number!==truck)continue;
    const id=String(parent.source_record_id || '').match(/^v3-position-(\d+)-(\d+)$/);
    if(!id)continue;
    const file=path.join(root,'history','linxup','push',date,`position-${id[1]}-${id[2]}.json`);
    try {
      const stat=fs.statSync(file);
      if(stat.size>1_048_576)continue;
      const version=`${stat.mtimeMs}:${stat.size}`;
      let raw=cache.get(file);
      if(raw?.version!==version) {
        const envelope=JSON.parse(fs.readFileSync(file,'utf8'));
        if(!envelope.payload || typeof envelope.payload!=='object')continue;
        raw={version,payload:envelope.payload};cache.delete(file);cache.set(file,raw);
        while(cache.size>4096)cache.delete(cache.keys().next().value!);
      }
      const tracker=raw.payload.tracker as Row|undefined;
      if(String(tracker?.trackerId ?? tracker?.id)!==id[1] || Number(id[2])!==Number(raw.payload.date ?? raw.payload.positionDate))continue;
      detail.push(...batchedRoutePositions(raw.payload,parent));
    } catch { /* An unavailable envelope cannot hide the main GPS history. */ }
  }
  return {...source,points:[...points,...detail]};
}
