import fs from 'node:fs';
import path from 'node:path';
import {chicagoDateKey} from './chicago-date';
import type {FleetMileage} from './fleet-service-plan';
type Point={timestamp:string;truck:string;latitude:number;longitude:number};
type Trip={truck:string;start:number;end:number;miles:number;id:string};
export type MileageGpsDay={date:string;observedAt:string;points:Point[];trips:Trip[]};
const key=(truck:string)=>truck.match(/\d+/)?.[0];
const distance=(a:Point,b:Point)=>{
 const r=Math.PI/180,x=Math.sin((b.latitude-a.latitude)*r/2)**2+Math.cos(a.latitude*r)*Math.cos(b.latitude*r)*Math.sin((b.longitude-a.longitude)*r/2)**2;
 return 3958.7613*2*Math.asin(Math.min(1,Math.sqrt(x)));
};
const valid=(p:Point)=>Number.isFinite(p.latitude)&&Number.isFinite(p.longitude)&&Math.abs(p.latitude)<=90&&Math.abs(p.longitude)<=180&&!(p.latitude===0&&p.longitude===0);
/** Recompute from one visual baseline. Never add a prior computed total again. */
export function advanceInspectionMileage(truck:string, baseline:FleetMileage, days:MileageGpsDay[], now=Date.now()):FleetMileage {
 if(baseline.source!=='inspection'||baseline.value===null||baseline.conflicting)return baseline;
 const start=Date.parse(baseline.reportedAt);
 const relevant=days.filter(d=>d.date>=chicagoDateKey(new Date(start))&&d.date<=chicagoDateKey(new Date(now)));
 const points=relevant.flatMap(d=>d.points).filter(p=>key(p.truck)===key(truck)&&valid(p)&&Date.parse(p.timestamp)>=start&&Date.parse(p.timestamp)<=now).sort((a,b)=>a.timestamp.localeCompare(b.timestamp));
 const seen=new Set<string>();
 const trips=relevant.flatMap(d=>d.trips).filter(t=>key(t.truck)===key(truck)&&t.start>=start&&t.end>t.start&&t.end<=now&&Number.isFinite(t.miles)&&t.miles>=0&&t.miles/(t.end-t.start)*3600000<=100).sort((a,b)=>a.start-b.start||a.end-b.end).filter(t=>{const id=`${t.start}:${t.end}`;if(seen.has(id))return false;seen.add(id);return true;});
 let miles=0,lastEnd=start,incomplete=false,asOf=start;
 const accepted:Trip[]=[];
 for(const trip of trips){if(trip.start<lastEnd){incomplete=true;continue;}accepted.push(trip);miles+=trip.miles;lastEnd=trip.end;asOf=Math.max(asOf,trip.end);}
 for(let i=1;i<points.length;i++){
  const a=points[i-1],b=points[i],from=Date.parse(a.timestamp),to=Date.parse(b.timestamp),elapsed=to-from;
  if(elapsed<=0)continue;
  // Completed provider trips already account for these segments; do not double count.
  if(accepted.some(t=>from>=t.start&&to<=t.end))continue;
  if(accepted.some(t=>from<t.end&&to>t.start))continue;
  const step=distance(a,b);
  if(elapsed>300000||step/elapsed*3600000>100){if(step>.05)incomplete=true;continue;}
  // Ignore stationary GPS drift; moving segments remain estimates of the observed path.
  if(step>=.01)miles+=step;
  asOf=Math.max(asOf,to);
 }
 if(points.length&&Date.parse(points[0].timestamp)-start>300000&&!accepted.some(t=>t.start<=start+300000))incomplete=true;
 const firstDay=chicagoDateKey(new Date(start)),lastDay=chicagoDateKey(new Date(now));
 for(let day=new Date(`${firstDay}T12:00:00Z`);day.toISOString().slice(0,10)<=lastDay;day=new Date(day.getTime()+86400000))if(!relevant.some(d=>d.date===day.toISOString().slice(0,10)))incomplete=true;
 const observed=points.at(-1);if(observed)asOf=Math.max(asOf,Date.parse(observed.timestamp));
 if(asOf===start)return {...baseline,note:`${baseline.note || ''} GPS travel after this inspection is unavailable.`};
 const value=Math.round((baseline.value+miles)*10)/10;
 return {...baseline,value,source:'estimated',estimated:value,reportedAt:new Date(asOf).toISOString(),retrievedAt:new Date(now).toISOString(),gpsIncomplete:incomplete,inspectionBaseline:{value:baseline.value,reportedAt:baseline.reportedAt},gpsMiles:Math.round(miles*10)/10,note:`Visual inspection ${baseline.value.toLocaleString('en-US')} mi + ${miles.toFixed(1)} GPS mi since the inspection. ${incomplete?'GPS gaps: recorded travel only; actual mileage may be higher.':'Calculated from LinxUp trips and GPS positions; verify against the next visual reading.'}`};
}
const cache=new Map<string,{signature:string;day:MileageGpsDay}>();
export function readMileageGpsDays(since:string, now=Date.now()):MileageGpsDay[] {
 if(!Number.isFinite(Date.parse(since)))return [];
 const earliest=chicagoDateKey(new Date(Math.max(Date.parse(since),now-90*86400000))),today=chicagoDateKey(new Date(now));
 const root=process.env.OPSCENTER_DATA_DIR||process.env.OPSBOT_DATA_DIR||path.join(process.cwd(),'data');
 const dir=path.join(root,'history','linxup');
 let files:string[];try{files=fs.readdirSync(dir);}catch{return [];}
 return files.filter(f=>/^linxup_location_\d{4}-\d{2}-\d{2}\.json$/.test(f)&&f.slice(16,26)>=earliest&&f.slice(16,26)<=today).sort().flatMap(f=>{
  const file=path.join(dir,f);
  try{
   const stat=fs.statSync(file),signature=`${stat.mtimeMs}:${stat.size}`;const saved=cache.get(file);if(saved?.signature===signature)return [saved.day];
   const raw=JSON.parse(fs.readFileSync(file,'utf8'));
   const day:MileageGpsDay={date:f.slice(16,26),observedAt:String(raw.collection_timestamp||''),points:(raw.points||[]).map((p:Record<string,unknown>)=>({truck:String(p.truck_number||p.truck||p.truckNumber||''),timestamp:String(p.timestamp||''),latitude:p.latitude==null?NaN:Number(p.latitude),longitude:p.longitude==null?NaN:Number(p.longitude)})),trips:(raw.trips||[]).map((t:Record<string,unknown>)=>({truck:String(t.personName||t.truck_number||t.driverName||''),start:Number(t.startDateTime),end:Number(t.endDateTime),miles:t.distanceMilesDetailed==null&&t.distanceMiles==null?NaN:Number(t.distanceMilesDetailed??t.distanceMiles),id:String(t.tripUUID||'')}))};
   cache.set(file,{signature,day});while(cache.size>100)cache.delete(cache.keys().next().value!);return [day];
  }catch{return [];}
 });
}
