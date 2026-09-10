import type { GpsTrip, GpsRoutePoint } from '../desktop-ui/lib/gps-route-contract';
import { chicagoDateKey } from './chicago-date';

const truckName = (value:unknown) => String(value || '').replace(/^truck\s*#?\s*/i, 'Truck ').trim();
const distance = (a:{latitude:number;longitude:number}, b:{latitude:number;longitude:number}) => {
  const rad=Math.PI/180, lat=(b.latitude-a.latitude)*rad, lon=(b.longitude-a.longitude)*rad;
  return 12_742_000*Math.asin(Math.min(1,Math.sqrt(Math.sin(lat/2)**2+Math.cos(a.latitude*rad)*Math.cos(b.latitude*rad)*Math.sin(lon/2)**2)));
};
function recordedTrips(payload:unknown,truck:string,now:number) {
  const rows=(payload as {trips?:unknown[]})?.trips;
  if(!Array.isArray(rows)) return [];
  return rows.flatMap(raw=>{
    if(!raw || typeof raw!=='object') return [];
    const row=raw as Record<string,unknown>;
    if(truckName(row.personName || row.truck_number || row.driverName)!==truck) return [];
    const start=Number(row.startDateTime), end=Number(row.endDateTime);
    if(!start || !end || !Number.isFinite(start) || !Number.isFinite(end) || start>end || end>now) return [];
    const endpoint=(prefix:'start'|'end')=>{
      const latitude=Number(row[`${prefix}Latitude`]),longitude=Number(row[`${prefix}Longitude`]);
      if(row[`${prefix}Latitude`]==null || row[`${prefix}Longitude`]==null || !Number.isFinite(latitude) || !Number.isFinite(longitude) || Math.abs(latitude)>90 || Math.abs(longitude)>180 || latitude===0 && longitude===0) return null;
      return {latitude,longitude,address:String(row[`${prefix}Address`] || '').trim().replace(/,\s*(USA|United States)$/i,'')};
    };
    const from=endpoint('start'),to=endpoint('end');
    if(!from || !to) return [];
    return [{id:String(row.tripUUID || `${start}:${end}`),departure:new Date(start).toISOString(),arrival:new Date(end).toISOString(),from,to,miles:Number(row.distanceMilesDetailed ?? row.distanceMiles)}];
  }).sort((a,b)=>a.departure.localeCompare(b.departure) || a.arrival.localeCompare(b.arrival) || a.id.localeCompare(b.id));
}

export function normalizeGpsTrips(payload:unknown,date:string,truck:string,now=Date.now()):GpsTrip[] {
  const seen=new Set<string>();
  return recordedTrips(payload,truck,now).filter(trip=>{
    if(chicagoDateKey(new Date(trip.departure))!==date || seen.has(trip.id)) return false;
    seen.add(trip.id);
    // Ignition cycles while parked do not create Point A to Point B travel.
    return trip.miles>=.03 || distance(trip.from,trip.to)>=30;
  }).map(({miles:_,...trip},index)=>({...trip,number:index+1}));
}

export function lastLinxupAddress(payload:unknown,truck:string,point:GpsRoutePoint|null,now=Date.now()):string|null {
  if(!point) return null;
  return recordedTrips(payload,truck,now).reverse().find(trip=>trip.to.address && Date.parse(trip.arrival)<=Date.parse(point.timestamp)+60_000 && distance(trip.to,point)<=30)?.to.address || null;
}
