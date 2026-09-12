import {createHash} from 'node:crypto';
import type {GpsRoutePoint,RoadCoordinate,StreetRoute,TruckGpsRoute} from '../desktop-ui/lib/gps-route-contract';
import {osmStreetJson} from './osm-street-transport';
import {reuseStreetPaths} from '../desktop-ui/lib/gps-street-progress';

export function gpsSourceVersion(route:TruckGpsRoute) {return createHash('sha256').update(JSON.stringify([route.date,route.truck,route.points,route.paths,route.gapLinks])).digest('hex').slice(0,24);}
export function meters(a:RoadCoordinate,b:RoadCoordinate){
  const rad=Math.PI/180,lat=(b.latitude-a.latitude)*rad,lng=(b.longitude-a.longitude)*rad;
  return 12_742_000*Math.asin(Math.min(1,Math.sqrt(Math.sin(lat/2)**2+Math.cos(a.latitude*rad)*Math.cos(b.latitude*rad)*Math.sin(lng/2)**2)));
}
const coordinate=(p:unknown):p is RoadCoordinate=>{const v=p as RoadCoordinate;return !!v && Number.isFinite(v.latitude) && Math.abs(v.latitude)<=90 && Number.isFinite(v.longitude) && Math.abs(v.longitude)<=180;};
const pointKey=(point:GpsRoutePoint)=>JSON.stringify(point);
export function eligibleStreetEdges(route:TruckGpsRoute) {
  const indices=new Map(route.points.map((p,i)=>[pointKey(p),i]));
  const edges=new Set<number>();
  for(const run of [...route.paths,...(route.gapLinks || [])]) for(let i=1;i<run.length;i++){
    const a=indices.get(pointKey(run[i-1])),b=indices.get(pointKey(run[i]));
    if(a!==undefined && b===a+1)edges.add(a);
  }
  return edges;
}
type OsrmLeg={steps?:{geometry?:{coordinates?:unknown}}[]};
type OsrmMatch={confidence?:number;legs?:OsrmLeg[]};
type OsrmTrace={matchings_index:number;waypoint_index:number;alternatives_count?:number};
export function roadCoordinates(raw:unknown,a:RoadCoordinate,b:RoadCoordinate):RoadCoordinate[]|null {
  if(!Array.isArray(raw) || raw.length<2 || raw.length>20000)return null;
  const points=raw.map(p=>Array.isArray(p)?{longitude:p[0],latitude:p[1]}:null);
  if(!points.every(coordinate))return null;
  if(meters(a,points[0])>150 || meters(b,points.at(-1)!)>150)return null;
  const distance=points.reduce((sum,p,i)=>sum+(i?meters(points[i-1],p):0),0);
  return distance<=Math.max(2000,meters(a,b)*6)?points:null;
}
function legCoordinates(leg:OsrmLeg|undefined,a:RoadCoordinate,b:RoadCoordinate) {
  if(!Array.isArray(leg?.steps) || !leg.steps.length)return null;
  const joined:unknown[]=[];
  for(const step of leg.steps){
    const raw=step.geometry?.coordinates;
    if(!Array.isArray(raw) || !raw.length)return null;
    // Separate provider steps must actually meet; do not add connector chords.
    if(joined.length && JSON.stringify(joined.at(-1))!==JSON.stringify(raw[0]))return null;
    joined.push(...raw);
  }
  return roadCoordinates(joined,a,b);
}
export function matchedStreetEdges(payload:unknown,source:GpsRoutePoint[]) {
  const result=new Map<number,StreetRoute['paths'][number]>();
  const data=payload as {code?:string;tracepoints?:(OsrmTrace|null)[];matchings?:OsrmMatch[]}|null;
  if(data?.code!=='Ok' || !Array.isArray(data.tracepoints) || data.tracepoints.length!==source.length || !Array.isArray(data.matchings))return result;
  for(let i=0;i<source.length-1;i++){
    const a=data.tracepoints[i],b=data.tracepoints[i+1];
    // Null/outlier observations and distinct sub-traces are never bridged.
    if(!a || !b || !Number.isInteger(a.matchings_index) || !Number.isInteger(a.waypoint_index) || a.waypoint_index<0 || a.matchings_index!==b.matchings_index || b.waypoint_index!==a.waypoint_index+1)continue;
    const match=data.matchings[a.matchings_index],points=legCoordinates(match?.legs?.[a.waypoint_index],source[i],source[i+1]);
    if(!points)continue;
    const confident=(match?.confidence || 0)>=.7 && a.alternatives_count===0 && b.alternatives_count===0;
    const frequent=meters(source[i],source[i+1])<=300 && Date.parse(source[i+1].timestamp)-Date.parse(source[i].timestamp)<=90_000;
    result.set(i,{kind:confident && frequent?'matched':'estimated',points});
  }
  return result;
}
type StreetProgress = StreetRoute & {nextEdge?:number};
export async function buildStreetRoute(route:TruckGpsRoute,send:typeof osmStreetJson=osmStreetJson,previous?:StreetProgress):Promise<StreetProgress>{
  const sourceVersion=gpsSourceVersion(route),eligible=eligibleStreetEdges(route),matched=new Map<number,StreetRoute['paths'][number]>();
  if(previous?.sourceVersion===sourceVersion)for(const path of previous.paths) {
    if(path.sourceEdge!==undefined && eligible.has(path.sourceEdge))matched.set(path.sourceEdge,path);
  }
  let nextEdge=previous?.sourceVersion===sourceVersion ? previous.nextEdge || 0 : 0;
  const deadline=Date.now()+16_000;
  const runs:number[][]=[];
  // Exclude long/impossible gaps before asking the matcher to infer any route.
  const remaining=[...eligible].filter(edge=>!matched.has(edge));
  // Rotate past slow or failed batches on the next read, while retaining every
  // successful edge. The same early failure must not starve the later trips.
  const ordered=remaining.sort((a,b)=>(a<nextEdge?1:0)-(b<nextEdge?1:0)||a-b);
  for(const edge of ordered){
    const run=runs.at(-1);
    if(run?.at(-1)===edge)run.push(edge+1);else runs.push([edge,edge+1]);
  }
  // The public service accepts ten trace coordinates per request.
  for(const run of runs)for(let offset=0;offset<run.length-1 && Date.now()<deadline;offset+=9){
    const indices=run.slice(offset,offset+10),points=indices.map(i=>route.points[i]);
    // Provider receives only coordinates, never truck IDs, dates or job details.
    const coords=points.map(p=>`${p.longitude},${p.latitude}`).join(';');
    const params=new URLSearchParams({steps:'true',geometries:'geojson',overview:'false',tidy:'false',gaps:'split',radiuses:points.map(()=>'25').join(';')});
    const response=await send(`match/v1/driving/${coords}?${params}`);
    for(const [i,path] of matchedStreetEdges(response,points))matched.set(indices[i],path);
    // Resolve sparse batches before proceeding to the next match request.
    // Otherwise a long day's matching attempts consume every time slice and
    // the road-routing fallback never runs. One multi-stop request supplies
    // per-edge road geometry instead of a request for every missing edge.
    if(indices.slice(0,-1).some(i=>!matched.has(i)) && Date.now()<deadline) {
      const options=new URLSearchParams({steps:'true',geometries:'geojson',overview:'false',alternatives:'false',radiuses:points.map(()=>'150').join(';')});
      const roads=await send(`route/v1/driving/${coords}?${options}`) as {code?:string;routes?:{legs?:OsrmLeg[]}[]}|null;
      if(roads?.code==='Ok')for(let i=0;i<indices.length-1;i++) {
        if(matched.has(indices[i]))continue;
        const geometry=legCoordinates(roads.routes?.[0]?.legs?.[i],points[i],points[i+1]);
        if(geometry)matched.set(indices[i],{kind:'estimated',points:geometry});
      }
    }
    nextEdge=indices.at(-1)!%Math.max(1,route.points.length-1);
  }
  const missing=[...eligible].filter(i=>!matched.has(i) && meters(route.points[i],route.points[i+1])>30);
  // Sparse observations may not match. A road route between them is explicitly
  // estimated, and never a claim that these were the exact streets driven.
  for(const i of missing){
    if(Date.now()>=deadline)break;
    const a=route.points[i],b=route.points[i+1];
    const response=await send(`route/v1/driving/${a.longitude},${a.latitude};${b.longitude},${b.latitude}?overview=full&geometries=geojson&alternatives=false&radiuses=150;150`) as {code?:string;routes?:{geometry?:{coordinates?:unknown}}[]}|null;
    const points=response?.code==='Ok'?roadCoordinates(response.routes?.[0]?.geometry?.coordinates,a,b):null;
    if(points)matched.set(i,{kind:'estimated',points});
  }
  const paths=[...matched].sort(([a],[b])=>a-b).map(([sourceEdge,path])=>({...path,sourceEdge})),unmatched=missing.filter(i=>!matched.has(i)).length;
  return {sourceVersion,status:paths.length?(unmatched?'partial':'available'):'unavailable',paths,unmatched,nextEdge};
}
const pending=new Map<string,Promise<StreetProgress>>();
const completed=new Map<string,{until:number;route:StreetProgress}>();
const latest=new Map<string,{source:TruckGpsRoute;result:StreetProgress}>();
export function reusableStreetProgress(source:TruckGpsRoute,previous?:{source:TruckGpsRoute;result:StreetProgress}):StreetProgress|undefined {
  if(!previous || previous.source.date!==source.date || previous.source.truck!==source.truck)return undefined;
  const paths=reuseStreetPaths(source,previous.source,previous.result.paths);
  return {...previous.result,sourceVersion:gpsSourceVersion(source),paths};
}
export function readStreetRoute(route:TruckGpsRoute,send:typeof osmStreetJson=osmStreetJson){
  const key=gpsSourceVersion(route),cached=completed.get(key);
  if(cached && cached.until>Date.now())return Promise.resolve(cached.route);
  const truckKey=`${route.date}:${route.truck}`;
  const previous=cached?.route || reusableStreetProgress(route,latest.get(truckKey));
  const eligible=eligibleStreetEdges(route);
  const paths=(previous?.paths || []).filter(path=>path.sourceEdge!==undefined && eligible.has(path.sourceEdge));
  const aligned=new Set(paths.map(path=>path.sourceEdge));
  const unmatched=[...eligible].filter(i=>!aligned.has(i) && meters(route.points[i],route.points[i+1])>30).length;
  const visible:StreetProgress={sourceVersion:key,paths,unmatched,status:unmatched?'partial':paths.length?'available':'unavailable'};
  // The public matcher shares a rate-limited queue with road ETAs. Never make
  // the browser wait for that queue or discard all progress at its timeout.
  // Only a viewer request starts a bounded slice; there is no fleet-wide loop.
  if(!pending.has(truckKey)) {
    const request=buildStreetRoute(route,send,previous).then(result=>{
      latest.set(truckKey,{source:route,result});
      while(latest.size>32)latest.delete(latest.keys().next().value!);
      completed.set(key,{route:result,until:Date.now()+(result.status==='available'?24*60*60_000:60_000)});
      while(completed.size>32)completed.delete(completed.keys().next().value!);
      return result;
    }).catch(()=>visible).finally(()=>pending.delete(truckKey));
    pending.set(truckKey,request);
  }
  return Promise.resolve(visible);
}
