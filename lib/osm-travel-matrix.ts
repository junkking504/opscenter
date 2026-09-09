import type {Coordinates,RoadMatrixElement} from './job-route-proximity';
import {osmStreetJson} from './osm-street-transport';

const located=(p:Coordinates)=>Number.isFinite(p.latitude) && Math.abs(p.latitude)<=90 && Number.isFinite(p.longitude) && Math.abs(p.longitude)<=180;
/** Road-network estimates, without traffic. Reuses the GPS road provider's
 * shared rate limit/cache; no customer identities or addresses leave the app. */
export async function osmTravelMatrix(origins:Coordinates[],destinations:Coordinates[],send:typeof osmStreetJson=osmStreetJson):Promise<RoadMatrixElement[]|null>{
  if(!origins.length || !destinations.length || origins.length*destinations.length>625 || ![...origins,...destinations].every(located))return null;
  const result:RoadMatrixElement[]=[];
  if(origins.length*destinations.length>1){
    // Truck-to-job comparisons use only the requested rectangular table.
    // Small chunks also keep the public service's coordinate limit bounded.
    for(let from=0;from<origins.length;from+=5)for(let to=0;to<destinations.length;to+=5){
      const source=origins.slice(from,from+5),target=destinations.slice(to,to+5),points=[...source,...target];
      const params=new URLSearchParams({sources:source.map((_,i)=>String(i)).join(';'),destinations:target.map((_,i)=>String(i+source.length)).join(';'),annotations:'duration,distance',radiuses:points.map(()=>'150').join(';')});
      const data=await send(`table/v1/driving/${points.map(p=>`${p.longitude},${p.latitude}`).join(';')}?${params}`).catch(()=>null) as {code?:string;durations?:unknown[][];distances?:unknown[][];sources?:{distance?:number}[];destinations?:{distance?:number}[]}|null;
      if(data?.code!=='Ok')continue;
      for(let i=0;i<source.length;i++)for(let j=0;j<target.length;j++){
        const seconds=data.durations?.[i]?.[j],meters=data.distances?.[i]?.[j];
        if(typeof seconds!=='number' || !Number.isFinite(seconds) || seconds<0 || typeof meters!=='number' || !Number.isFinite(meters) || meters<0 || ![data.sources?.[i]?.distance,data.destinations?.[j]?.distance].every(n=>typeof n==='number' && Number.isFinite(n) && n>=0 && n<=150))continue;
        result.push({originIndex:from+i,destinationIndex:to+j,condition:'ROUTE_EXISTS',duration:`${seconds}s`,distanceMeters:meters});
      }
    }
    return result;
  }

  for(let originIndex=0;originIndex<origins.length;originIndex++)for(let destinationIndex=0;destinationIndex<destinations.length;destinationIndex++){
    const a=origins[originIndex],b=destinations[destinationIndex];
    const data=await send(`route/v1/driving/${a.longitude},${a.latitude};${b.longitude},${b.latitude}?overview=false&alternatives=false&radiuses=150;150`).catch(()=>null) as {code?:string;routes?:{duration?:unknown;distance?:unknown}[];waypoints?:{distance?:unknown}[]}|null;
    const route=data?.routes?.[0],seconds=route?.duration,meters=route?.distance;
    // Reject off-road snaps and malformed/missing provider metrics. Zero is a
    // valid reported route; absence must never be coerced into zero travel.
    if(data?.code!=='Ok' || typeof seconds!=='number' || !Number.isFinite(seconds) || seconds<0 || typeof meters!=='number' || !Number.isFinite(meters) || meters<0 || data.waypoints?.length!==2 || !data.waypoints.every(p=>typeof p.distance==='number' && Number.isFinite(p.distance) && p.distance>=0 && p.distance<=150))continue;
    result.push({originIndex,destinationIndex,condition:'ROUTE_EXISTS',duration:`${seconds}s`,distanceMeters:meters});
  }
  return result;
}
