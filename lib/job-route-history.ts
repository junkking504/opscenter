export type JobRouteHistoryPoint = {
  timestamp: string;
  latitude: number;
  longitude: number;
};

export type JobRouteHistoryStop = {
  label: string;
  latitude: number;
  longitude: number;
  begin: string;
  end: string;
};

export type JobRouteHistorySegment = {
  key: string;
  label: string;
  color: string;
  kind: "job" | "current";
  points: JobRouteHistoryPoint[];
  paths: JobRouteHistoryPoint[][];
  stop: JobRouteHistoryStop | null;
};

const JOB_ROUTE_COLORS = [
  "#38bdf8",
  "#f59e0b",
  "#a78bfa",
  "#22c55e",
  "#fb7185",
  "#2dd4bf",
  "#f97316",
  "#818cf8",
];

const CURRENT_ROUTE_COLOR = "#cbd5e1";
// Keep raw observations available, but never draw a connector that would
// require a heavy truck to teleport between consecutive GPS timestamps.
const MAX_PLAUSIBLE_ROUTE_SPEED_MPH = 100;
const ROUTE_POINT_JITTER_METERS = 100;

function timestamp(value: string): number {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : Number.NaN;
}

function validPoint(point: JobRouteHistoryPoint): boolean {
  return Number.isFinite(timestamp(point.timestamp))
    && Number.isFinite(point.latitude)
    && Number.isFinite(point.longitude);
}

function distanceMeters(from: JobRouteHistoryPoint, to: JobRouteHistoryPoint): number {
  const radians = (degrees: number) => degrees * Math.PI / 180;
  const latitudeDelta = radians(to.latitude - from.latitude);
  const longitudeDelta = radians(to.longitude - from.longitude);
  const a = Math.sin(latitudeDelta / 2) ** 2
    + Math.cos(radians(from.latitude)) * Math.cos(radians(to.latitude)) * Math.sin(longitudeDelta / 2) ** 2;
  return 6_371_000 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function plausibleTransition(from: JobRouteHistoryPoint, to: JobRouteHistoryPoint): boolean {
  const distance = distanceMeters(from, to);
  if (distance <= ROUTE_POINT_JITTER_METERS) return true;

  const elapsedMs = timestamp(to.timestamp) - timestamp(from.timestamp);
  if (elapsedMs <= 0) return false;

  const impliedSpeedMph = distance / 1_609.344 / (elapsedMs / 3_600_000);
  return impliedSpeedMph <= MAX_PLAUSIBLE_ROUTE_SPEED_MPH;
}

export function splitPlausibleRouteRuns(rawPoints: JobRouteHistoryPoint[]): JobRouteHistoryPoint[][] {
  const points = rawPoints
    .filter(validPoint)
    .sort((left, right) => timestamp(left.timestamp) - timestamp(right.timestamp));
  if (!points.length) return [];

  const runs: JobRouteHistoryPoint[][] = [[points[0]]];
  for (const point of points.slice(1)) {
    const activeRun = runs[runs.length - 1];
    const previous = activeRun[activeRun.length - 1];
    if (!plausibleTransition(previous, point)) {
      runs.push([point]);
      continue;
    }
    activeRun.push(point);
  }
  return runs;
}

function closestPointIndex(points: JobRouteHistoryPoint[], targetTime: number, minimumIndex: number): number {
  let bestIndex = Math.min(Math.max(minimumIndex, 0), Math.max(points.length - 1, 0));
  let bestDifference = Number.POSITIVE_INFINITY;
  for (let index = bestIndex; index < points.length; index += 1) {
    const difference = Math.abs(timestamp(points[index].timestamp) - targetTime);
    if (difference <= bestDifference) {
      bestIndex = index;
      bestDifference = difference;
      continue;
    }
    if (timestamp(points[index].timestamp) > targetTime) break;
  }
  return bestIndex;
}

export function buildJobRouteHistory(
  rawPoints: JobRouteHistoryPoint[],
  rawStops: JobRouteHistoryStop[],
): JobRouteHistorySegment[] {
  const points = rawPoints
    .filter(validPoint)
    .sort((left, right) => timestamp(left.timestamp) - timestamp(right.timestamp));
  if (points.length < 2) return [];

  const stops = rawStops
    .filter((stop) => Number.isFinite(timestamp(stop.begin)))
    .sort((left, right) => timestamp(left.begin) - timestamp(right.begin));
  const segments: JobRouteHistorySegment[] = [];
  let cursor = 0;

  for (const [index, stop] of stops.entries()) {
    const arrivalIndex = closestPointIndex(points, timestamp(stop.begin), cursor);
    const segmentPoints = points.slice(cursor, arrivalIndex + 1);
    if (segmentPoints.length > 1) {
      segments.push({
        key: `job-${index}-${stop.label}-${stop.begin}`,
        label: `To ${stop.label}`,
        color: JOB_ROUTE_COLORS[index % JOB_ROUTE_COLORS.length],
        kind: "job",
        points: segmentPoints,
        paths: splitPlausibleRouteRuns(segmentPoints).filter((path) => path.length > 1),
        stop,
      });
    }

    const departureTime = timestamp(stop.end);
    cursor = Number.isFinite(departureTime)
      ? closestPointIndex(points, departureTime, arrivalIndex)
      : arrivalIndex;
  }

  const currentPoints = points.slice(cursor);
  if (currentPoints.length > 1) {
    const lastStop = stops.at(-1);
    segments.push({
      key: `current-${currentPoints[0].timestamp}`,
      label: lastStop ? `After ${lastStop.label}` : "Today’s route",
      color: CURRENT_ROUTE_COLOR,
      kind: "current",
      points: currentPoints,
      paths: splitPlausibleRouteRuns(currentPoints).filter((path) => path.length > 1),
      stop: null,
    });
  }

  return segments;
}
