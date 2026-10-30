import fs from 'node:fs';
import path from 'node:path';
import {gpsDistanceMeters, validGpsCoordinates, GPS_SITE_RADIUS_METERS} from './gps-presence-policy';
import type {AnyRecord} from './opsData';
const truckKey=(value:unknown)=>String(value || '').match(/\d+/)?.[0]?.replace(/^0+/,'') || '';

/** Restore positive stationary coverage omitted from the ledger schema, without
 * changing the ledger or guessing across silent periods. Only adjacent fixes
 * already attributed to this exact interval may support a continuity bridge. */
export function withAppointmentContinuity(rows:AnyRecord[], points:AnyRecord[], now=Date.now()):AnyRecord[] {
  return rows.map(row=>{
    const location=row.visit_pin?.location;
    if (!validGpsCoordinates(location || {}) || !truckKey(row.truck_number || row.truck)) return row;
    const grouped=new Map<number,AnyRecord[]>();
    for(const point of points) {
      const time=Date.parse(point.timestamp || '');
      if(truckKey(point.truck_number || point.truck)!==truckKey(row.truck_number || row.truck) || !Number.isFinite(time) || time>now)continue;
      grouped.set(time,[...(grouped.get(time)||[]),point]);
    }
    const ordered=[...grouped].sort((a,b)=>a[0]-b[0]).map(([time,samples])=>{
      const primary=samples.filter(p=>p.delivery_source==='v3_position_push');
      const selected=primary.length?primary:samples;
      const valid=selected.every(p=>validGpsCoordinates(p)) && new Set(selected.map(p=>`${p.latitude}:${p.longitude}`)).size===1;
      return {time,point:valid?selected[0] as AnyRecord:undefined};
    });
    const intervals=row.visit_intervals?.length?row.visit_intervals:[{arrival:row.first_arrival || row.arrival_at,departure:row.final_departure || row.departure_at,source_timestamps:row.source_timestamps}];
    return {...row,visit_intervals:intervals.map((interval:AnyRecord)=>{
      const start=Date.parse(interval.arrival || ''),end=interval.departure_confirmed!==false && interval.departure?Date.parse(interval.departure):now;
      const attributed=new Set((interval.source_timestamps?.length?interval.source_timestamps:intervals.length===1?row.source_timestamps || []:[]).map(Date.parse));
      const source_continuity:Array<{start:string;end:string}>=[];
      for(let i=1;i<ordered.length;i++) {
        const left=ordered[i-1],right=ordered[i];
        if(left.time<start || right.time>end || !left.point || !right.point || !attributed.has(left.time) || !attributed.has(right.time))continue;
        const until=Date.parse(left.point.continuous_until || '');
        if(!Number.isFinite(until) || until<right.time || until>now || gpsDistanceMeters(location,left.point)>GPS_SITE_RADIUS_METERS || gpsDistanceMeters(location,right.point)>GPS_SITE_RADIUS_METERS)continue;
        source_continuity.push({start:new Date(left.time).toISOString(),end:new Date(right.time).toISOString()});
      }
      return {...interval,source_continuity};
    })};
  });
}

/** Shared by Schedule/tracking and notification preparation; local reads only. */
export function withSavedAppointmentContinuity(rows:AnyRecord[],date:string,root:string,now=Date.now()):AnyRecord[] {
  try {
    const payload=JSON.parse(fs.readFileSync(path.join(root,'history','linxup',`linxup_location_${date}.json`),'utf8'));
    return withAppointmentContinuity(rows,Array.isArray(payload.points)?payload.points:[],now);
  }catch{return rows;}
}
