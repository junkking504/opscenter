export type GpsRoutePoint = {timestamp:string;latitude:number;longitude:number};
export type TruckGpsRoute = {
  sourceVersion?:string;
  streets?:StreetRoute;
  date:string;
  truck:string;
  status:'available'|'empty'|'unavailable';
  observedAt:string|null;
  coveredThrough:string|null;
  points:GpsRoutePoint[];
  paths:GpsRoutePoint[][];
  /** Direction between sparse observations, never a claimed road traveled. */
  gapLinks?:GpsRoutePoint[][];
  gaps:number;
  rejected:number;
};
export type RoadCoordinate={latitude:number;longitude:number};
export type StreetRoute={
  sourceVersion:string;
  status:'available'|'partial'|'unavailable';
  paths:{kind:'matched'|'estimated';points:RoadCoordinate[]}[];
  unmatched:number;
};
