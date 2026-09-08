import {createHash} from 'node:crypto';
import type {GpsRoutePoint,RoadCoordinate,StreetRoute,TruckGpsRoute} from '../desktop-ui/lib/gps-route-contract';
import {googleMapJson} from './google-map-transport';

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
// Only neighboring reported points may be connected. A missing originalIndex
// means Roads could not match that observation, not permission to bridge it.
export function snappedStreetEdges(payload:unknown,source:GpsRoutePoint[]) {
  const result=new Map<number,RoadCoordinate[]>();
  const snapped=(payload as {snappedPoints?:unknown[]}|null)?.snappedPoints;
  if(!Array.isArray(snapped))return result;
  let start:number|null=null,points:RoadCoordinate[]=[];
  for(const raw of snapped){
    const value=raw as {location?:unknown;originalIndex?:unknown};
    if(!coordinate(value?.location)){start=null;points=[];continue;}
    const location={latitude:value.location.latitude,longitude:value.location.longitude};
    points.push(location);
    if(value.originalIndex===undefined)continue;
    const index=value.originalIndex;
    if(typeof index!=='number' || !Number.isInteger(index) || !source[index]){start=null;points=[];continue;}
    if(start!==null && index===start+1 && points.length>1 && meters(source[start],points[0])<=150 && meters(source[index],location)<=150 && points.every((p,i)=>!i || meters(points[i-1],p)<=300))result.set(start,points);
    start=index;points=[location];
  }
  return result;
}
export function routeCoordinates(payload:unknown,a:RoadCoordinate,b:RoadCoordinate):RoadCoordinate[]|null {
  const geometry=(payload as {routes?:{polyline?:{geoJsonLinestring?:{coordinates?:unknown}}}[]}|null)?.routes?.[0]?.polyline?.geoJsonLinestring?.coordinates;
  if(!Array.isArray(geometry) || geometry.length<2 || geometry.length>20000)return null;
  const points=geometry.map(p=>Array.isArray(p)?{latitude:p[1],longitude:p[0]}:null);
  if(!points.every(coordinate))return null;
  if(meters(a,points[0])>200 || meters(b,points.at(-1)!)>200)return null;
  const direct=meters(a,b),length=points.reduce((sum,p,i)=>sum+(i?meters(points[i-1],p):0),0);
  // Reject implausible detours instead of suggesting a distant accessible road.
  return length<=Math.max(2000,direct*6)?points:null;
}
type Json=typeof googleMapJson;
export async function buildStreetRoute(route:TruckGpsRoute,send:Json=googleMapJson):Promise<StreetRoute>{
  const sourceVersion=gpsSourceVersion(route),eligible=eligibleStreetEdges(route),matched=new Map<number,RoadCoordinate[]>();
  const paths:StreetRoute['paths']=[],deadline=Date.now()+16_000;
  // Bound work; any omitted edges are explicitly counted as unmatched.
  const batches=Array.from({length:Math.min(20,Math.ceil(Math.max(0,route.points.length-1)/99))},(_,i)=>i*99);
  let cursor=0;
  await Promise.all(Array.from({length:4},async()=>{while(cursor<batches.length && Date.now()<deadline){
    const offset=batches[cursor++],points=route.points.slice(offset,offset+100);
    if(!points.slice(0,-1).some((_,i)=>eligible.has(offset+i)))continue;
    const params=new URLSearchParams({path:points.map(p=>`${p.latitude},${p.longitude}`).join('|'),interpolate:'true'});
    const response=await send('roads.googleapis.com',`/v1/snapToRoads?${params}`);
    for(const [index,path] of snappedStreetEdges(response,points))if(eligible.has(offset+index))matched.set(offset+index,path);
  }}));
  const missing:number[]=[];
  for(const i of eligible){
    const a=route.points[i],b=route.points[i+1],path=matched.get(i);
    if(path){paths.push({kind:meters(a,b)>300 || Date.parse(b.timestamp)-Date.parse(a.timestamp)>300_000?'estimated':'matched',points:path});}
    else if(meters(a,b)>30)missing.push(i);
  }
  cursor=0;let restored=0;
  await Promise.all(Array.from({length:4},async()=>{while(cursor<Math.min(40,missing.length) && Date.now()<deadline){
    const i=missing[cursor++],a=route.points[i],b=route.points[i+1];
    // Send coordinates only, never timestamps or operational metadata.
    const body={origin:{location:{latLng:{latitude:a.latitude,longitude:a.longitude}}},destination:{location:{latLng:{latitude:b.latitude,longitude:b.longitude}}},travelMode:'DRIVE',routingPreference:'TRAFFIC_UNAWARE',polylineQuality:'HIGH_QUALITY',polylineEncoding:'GEO_JSON_LINESTRING'};
    const path=routeCoordinates(await send('routes.googleapis.com','/directions/v2:computeRoutes',body,'routes.polyline.geoJsonLinestring'),a,b);
    if(path){paths.push({kind:'estimated',points:path});restored++;}
  }}));
  const unmatched=missing.length-restored;
  return {sourceVersion,status:paths.length?(unmatched?'partial':'available'):'unavailable',paths,unmatched};
}
// Deduplicate simultaneous viewers only. Completed Google geometry is not
// persisted or cached; the active browser view holds its current response.
const pending=new Map<string,Promise<StreetRoute>>();
export function readStreetRoute(route:TruckGpsRoute){
  const key=gpsSourceVersion(route),existing=pending.get(key);if(existing)return existing;
  const request=buildStreetRoute(route).finally(()=>pending.delete(key));pending.set(key,request);return request;
}
