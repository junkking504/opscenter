export type GpsRoutePoint = {timestamp:string;latitude:number;longitude:number};
export type TruckGpsRoute = {
  date:string;
  truck:string;
  status:'available'|'empty'|'unavailable';
  observedAt:string|null;
  coveredThrough:string|null;
  points:GpsRoutePoint[];
  paths:GpsRoutePoint[][];
  gaps:number;
  rejected:number;
};
