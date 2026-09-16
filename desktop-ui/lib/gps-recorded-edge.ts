import type {GpsRoutePoint} from './gps-route-contract';

/** A frequent, physically plausible trace can be drawn without waiting for
 * a road provider. This is recorded GPS geometry, not road-matched geometry. */
export function recordedGpsEdge(a:GpsRoutePoint,b:GpsRoutePoint) {
  const seconds=(Date.parse(b.timestamp)-Date.parse(a.timestamp))/1000;
  if(!(seconds>0 && seconds<=15))return false;
  const rad=Math.PI/180;
  const distance=12_742_000*Math.asin(Math.min(1,Math.sqrt(Math.sin((b.latitude-a.latitude)*rad/2)**2
    +Math.cos(a.latitude*rad)*Math.cos(b.latitude*rad)*Math.sin((b.longitude-a.longitude)*rad/2)**2)));
  return distance<=400 && distance<=Math.max(30,seconds*44.704);
}
