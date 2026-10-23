export type GpsRoutePoint = {timestamp:string;latitude:number;longitude:number;/** Only set by the likely-stop matcher, from `TruckGpsRoute.coverage`. */coveredUntil?:string};
export type GpsTrip = {
  id:string; number:number; departure:string; arrival:string;
  from:{latitude:number;longitude:number;address:string};
  to:{latitude:number;longitude:number;address:string};
};
export type TruckGpsRoute = {
  trips?:GpsTrip[];
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
  /** Stationary observations that record coverage past their own timestamp; kept apart from `points` so geometry identity is unchanged. */
  coverage?:{timestamp:string;coveredUntil:string}[];
};
export type RoadCoordinate={latitude:number;longitude:number};
export type StreetRoute={
  retryAfterMs?:number;
  sourceVersion:string;
  status:'available'|'partial'|'unavailable';
  paths:{kind:'matched'|'estimated'|'recorded';points:RoadCoordinate[];sourceEdge?:number}[];
  unmatched:number;
};
