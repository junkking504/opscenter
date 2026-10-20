import type {Coordinates,RoadMatrixElement} from './job-route-proximity';
import {osmStreetJson} from './osm-street-transport';
import {roadCoordinates} from './desktop-street-route';

const located=(p:Coordinates)=>Number.isFinite(p.latitude) && Math.abs(p.latitude)<=90 && Number.isFinite(p.longitude) && Math.abs(p.longitude)<=180;
/** Road-network estimates, without traffic. Reuses the GPS road provider's
 * shared rate limit/cache; no customer identities or addresses leave the app. */
export async function osmTravelMatrix(origins:Coordinates[],destinations:Coordinates[],send:typeof osmStreetJson=osmStreetJson,budgetMs=30_000):Promise<RoadMatrixElement[]|null>{
  if(!origins.length || !destinations.length || origins.length*destinations.length>625 || ![...origins,...destinations].every(located))return null;
  // Per-request queue/provider timeouts do not bound a series of tables. Keep
  // the entire comparison below the browser's 45s timeout and retain completed
  // rows. Shared in-flight transport work may finish for other viewers/cache;
  // it must not mutate this response or start additional batches after expiry.
  const deadline=Date.now()+Math.max(1,Math.min(30_000,budgetMs));
  const read=async(path:string):Promise<unknown>=>{
    const remaining=deadline-Date.now();if(remaining<=0)return null;
    let timer:ReturnType<typeof setTimeout>|undefined;
    try {
      return await Promise.race([
        Promise.resolve().then(()=>send(path)).catch(()=>null),
        new Promise<null>(resolve=>{timer=setTimeout(()=>resolve(null),remaining);}),
      ]);
    } finally {if(timer)clearTimeout(timer);}
  };
  const result:RoadMatrixElement[]=[];
  if(origins.length*destinations.length>1){
    // Truck-to-job comparisons use only the requested rectangular table.
    // Small chunks also keep the public service's coordinate limit bounded.
    for(let from=0;from<origins.length;from+=5)for(let to=0;to<destinations.length;to+=5){
      if(Date.now()>=deadline)return result;
      const source=origins.slice(from,from+5),target=destinations.slice(to,to+5),points=[...source,...target];
      const params=new URLSearchParams({sources:source.map((_,i)=>String(i)).join(';'),destinations:target.map((_,i)=>String(i+source.length)).join(';'),annotations:'duration,distance',radiuses:points.map(()=>'150').join(';')});
      const data=await read(`table/v1/driving/${points.map(p=>`${p.longitude},${p.latitude}`).join(';')}?${params}`) as {code?:string;durations?:unknown[][];distances?:unknown[][];sources?:{distance?:number}[];destinations?:{distance?:number}[]}|null;
      // A table can fail because one coordinate cannot snap, or while the
      // provider still serves individual routes. Recover only missing pairs,
      // using the same total deadline and shared transport limits.
      const before=result.length;
      if(data?.code==='Ok')for(let i=0;i<source.length;i++)for(let j=0;j<target.length;j++){
        const seconds=data.durations?.[i]?.[j],meters=data.distances?.[i]?.[j];
        if(typeof seconds!=='number' || !Number.isFinite(seconds) || seconds<0 || typeof meters!=='number' || !Number.isFinite(meters) || meters<0 || ![data.sources?.[i]?.distance,data.destinations?.[j]?.distance].every(n=>typeof n==='number' && Number.isFinite(n) && n>=0 && n<=150))continue;
        result.push({originIndex:from+i,destinationIndex:to+j,condition:'ROUTE_EXISTS',duration:`${seconds}s`,distanceMeters:meters});
      }
      for(let i=0;i<source.length;i++)for(let j=0;j<target.length;j++){
        if(Date.now()>=deadline)return result;
        if(result.slice(before).some(row=>row.originIndex===from+i && row.destinationIndex===to+j))continue;
        const recovered=await osmTravelMatrix([source[i]],[target[j]],send,deadline-Date.now());
        for(const row of recovered || [])result.push({...row,originIndex:from+i,destinationIndex:to+j});
      }
    }
    return result;
  }

  for(let originIndex=0;originIndex<origins.length;originIndex++)for(let destinationIndex=0;destinationIndex<destinations.length;destinationIndex++){
    const a=origins[originIndex],b=destinations[destinationIndex];
    const data=await read(`route/v1/driving/${a.longitude},${a.latitude};${b.longitude},${b.latitude}?overview=full&geometries=geojson&alternatives=false&radiuses=150;150`) as {code?:string;routes?:{duration?:unknown;distance?:unknown;geometry?:{coordinates?:unknown}}[];waypoints?:{distance?:unknown}[]}|null;
    const route=data?.routes?.[0],seconds=route?.duration,meters=route?.distance;
    // Reject off-road snaps and malformed/missing provider metrics. Zero is a
    // valid reported route; absence must never be coerced into zero travel.
    if(data?.code!=='Ok' || typeof seconds!=='number' || !Number.isFinite(seconds) || seconds<0 || typeof meters!=='number' || !Number.isFinite(meters) || meters<0 || data.waypoints?.length!==2 || !data.waypoints.every(p=>typeof p.distance==='number' && Number.isFinite(p.distance) && p.distance>=0 && p.distance<=150))continue;
    const geometry=roadCoordinates(route?.geometry?.coordinates,a,b);
    result.push({originIndex,destinationIndex,condition:'ROUTE_EXISTS',duration:`${seconds}s`,distanceMeters:meters,...(geometry?{geometry}:{})});
  }
  return result;
}
