import type {GpsRoutePoint, StreetRoute, TruckGpsRoute} from './gps-route-contract';

const pointKey = (point: GpsRoutePoint) => JSON.stringify([point.timestamp, point.latitude, point.longitude]);

// A refreshed GPS history may insert late observations before existing trips.
// Retain geometry only when both exact observations still form an adjacent edge.
export function reuseStreetPaths(source: TruckGpsRoute, previous: TruckGpsRoute, paths: StreetRoute['paths']) {
  if (source.date !== previous.date || source.truck !== previous.truck) return [];
  const edges = new Map(source.points.slice(0, -1).map((point, index) =>
    [JSON.stringify([pointKey(point), pointKey(source.points[index + 1])]), index]));
  return paths.flatMap(path => {
    const i = path.sourceEdge;
    if (i === undefined || !previous.points[i] || !previous.points[i + 1]) return [];
    const index = edges.get(JSON.stringify([pointKey(previous.points[i]), pointKey(previous.points[i + 1])]));
    return index === undefined ? [] : [{...path, sourceEdge: index}];
  });
}
