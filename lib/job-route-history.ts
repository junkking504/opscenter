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

function timestamp(value: string): number {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : Number.NaN;
}

function validPoint(point: JobRouteHistoryPoint): boolean {
  return Number.isFinite(timestamp(point.timestamp))
    && Number.isFinite(point.latitude)
    && Number.isFinite(point.longitude);
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
      stop: null,
    });
  }

  return segments;
}
