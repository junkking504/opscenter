import type {GpsRoutePoint,GpsTrip,RoadCoordinate,TruckGpsRoute} from './gps-route-contract';

const tripColors=['#1d4ed8','#c2410c','#15803d','#9333ea','#be123c','#0e7490','#a16207','#4338ca','#047857','#c026d3','#475569','#9f1239','#4d7c0f','#7c3aed','#0369a1','#b45309'];
export const gpsTripColor=(number:number)=>tripColors[number-1] || `hsl(${Math.round(number*137.508)%360} 70% 35%)`;
export const unassignedGpsColor='#64748b';

function edgeTrip(trips:GpsTrip[],a:GpsRoutePoint,b:GpsRoutePoint) {
  // Use source times, never proximity: trips can revisit the same street.
  let best:GpsTrip|undefined,overlap=0;
  for(const trip of trips) {
    const duration=Math.min(Date.parse(b.timestamp),Date.parse(trip.arrival))-Math.max(Date.parse(a.timestamp),Date.parse(trip.departure));
    if(duration>overlap){best=trip;overlap=duration;}
  }
  return best;
}
export type GpsDisplayPath={points:RoadCoordinate[];trip?:GpsTrip;color:string;kind:'matched'|'estimated'|'recorded'|'gap';sourceEdge:number};
export function gpsTripDisplay(route:TruckGpsRoute,selectedTripId?:string|null) {
  const indices=new Map(route.points.map((point,index)=>[point.timestamp,index]));
  const edges=new Map<number,'recorded'|'gap'>();
  for(const [runs,kind] of [[route.paths,'recorded'],[route.gapLinks || [],'gap']] as const)
    for(const run of runs)for(let i=1;i<run.length;i++) {
      const a=indices.get(run[i-1].timestamp),b=indices.get(run[i].timestamp);
      if(a!==undefined && b===a+1)edges.set(a,kind);
    }
  const streets=new Map((route.streets?.sourceVersion===route.sourceVersion?route.streets?.paths || []:[]).map(path=>[path.sourceEdge,path]));
  const paths:GpsDisplayPath[]=[],connected=new Set<number>();
  for(const [index,kind] of [...edges].sort(([a],[b])=>a-b)) {
    const a=route.points[index],b=route.points[index+1],trip=edgeTrip(route.trips || [],a,b);
    if(selectedTripId && trip?.id!==selectedTripId)continue;
    const street=streets.get(index);
    paths.push({points:street?.points || [a,b],kind:street?.kind || kind,trip,color:trip?gpsTripColor(trip.number):unassignedGpsColor,sourceEdge:index});
    connected.add(index);connected.add(index+1);
  }
  const selected=route.trips?.find(trip=>trip.id===selectedTripId);
  const isolated=route.points.filter((point,index)=>!connected.has(index) && (!selectedTripId || selected && Date.parse(point.timestamp)>=Date.parse(selected.departure) && Date.parse(point.timestamp)<=Date.parse(selected.arrival)));
  return {paths,isolated};
}
