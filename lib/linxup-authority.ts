export const LINXUP_V3_AUTHORITY_MAX_AGE_SECONDS = 180;

export type LinxupDeliveryMode = "v3_position_push" | "v2_poll_fallback" | "last_known" | "unavailable";

export type LinxupPointLike = {
  timestamp?: unknown;
  tracker_id?: unknown;
  trackerId?: unknown;
  truck_number?: unknown;
  truckNumber?: unknown;
  truck?: unknown;
  latitude?: unknown;
  longitude?: unknown;
  speed?: unknown;
  ignition_state?: unknown;
  ignitionState?: unknown;
  ignition?: unknown;
  source_record_id?: unknown;
  sourceRecordId?: unknown;
  delivery_source?: unknown;
  deliverySource?: unknown;
};

export type LinxupAuthoritySelection<T extends LinxupPointLike> = {
  point: T | null;
  mode: LinxupDeliveryMode;
  fallbackActive: boolean;
  latestV3PositionAt: string | null;
};

export type LinxupV3StreamState = {
  latestPositionAt: string | null;
  fresh: boolean;
  expectedSilent: boolean;
};

function timestampMs(point: LinxupPointLike): number {
  const parsed = Date.parse(String(point.timestamp || ""));
  return Number.isFinite(parsed) ? parsed : Number.NEGATIVE_INFINITY;
}

export function isLinxupV3Position(point: LinxupPointLike): boolean {
  const deliverySource = String(point.delivery_source || point.deliverySource || "").trim().toLowerCase();
  const sourceRecordId = String(point.source_record_id || point.sourceRecordId || "").trim().toLowerCase();
  return deliverySource === "v3_position_push" || sourceRecordId.startsWith("v3-position-");
}

function latestPoint<T extends LinxupPointLike>(points: T[]): T | null {
  return points.reduce<T | null>((latest, point) => (
    !latest || timestampMs(point) > timestampMs(latest)
      || timestampMs(point) === timestampMs(latest) && isLinxupV3Position(point) && !isLinxupV3Position(latest) ? point : latest
  ), null);
}

function pointIdentity(point: LinxupPointLike): string {
  return String(
    point.tracker_id
      || point.trackerId
      || point.truck_number
      || point.truckNumber
      || point.truck
      || "unknown",
  ).trim().toLowerCase();
}

function ignitionState(point: LinxupPointLike): string {
  return String(point.ignition_state || point.ignitionState || point.ignition || "").trim().toUpperCase();
}

function distanceMeters(left: LinxupPointLike, right: LinxupPointLike): number | null {
  const leftLatitude = Number(left.latitude);
  const leftLongitude = Number(left.longitude);
  const rightLatitude = Number(right.latitude);
  const rightLongitude = Number(right.longitude);
  if (![leftLatitude, leftLongitude, rightLatitude, rightLongitude].every(Number.isFinite)) return null;
  const radians = (degrees: number) => degrees * Math.PI / 180;
  const latitudeDelta = radians(rightLatitude - leftLatitude);
  const longitudeDelta = radians(rightLongitude - leftLongitude);
  const a = Math.sin(latitudeDelta / 2) ** 2
    + Math.cos(radians(leftLatitude)) * Math.cos(radians(rightLatitude)) * Math.sin(longitudeDelta / 2) ** 2;
  return 6_371_000 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export function summarizeLinxupV3Stream(
  points: LinxupPointLike[],
  nowMs = Date.now(),
  maxV3AgeSeconds = LINXUP_V3_AUTHORITY_MAX_AGE_SECONDS,
): LinxupV3StreamState {
  const validV3 = points.filter(point => (
    isLinxupV3Position(point)
      && Number.isFinite(timestampMs(point))
      && timestampMs(point) <= nowMs
  ));
  const latestV3 = latestPoint(validV3);
  const latestByVehicle = new Map<string, LinxupPointLike>();
  for (const point of validV3) {
    const identity = pointIdentity(point);
    const current = latestByVehicle.get(identity);
    if (!current || timestampMs(point) > timestampMs(current)) latestByVehicle.set(identity, point);
  }
  const latestPolledByVehicle = new Map<string, LinxupPointLike>();
  for (const point of points) {
    if (isLinxupV3Position(point) || !Number.isFinite(timestampMs(point)) || timestampMs(point) > nowMs) continue;
    const identity = pointIdentity(point);
    const current = latestPolledByVehicle.get(identity);
    if (!current || timestampMs(point) > timestampMs(current)) latestPolledByVehicle.set(identity, point);
  }
  const latestPositionAt = latestV3 ? String(latestV3.timestamp || "") || null : null;
  const latestPositionMs = latestV3 ? timestampMs(latestV3) : Number.NEGATIVE_INFINITY;
  const fresh = Boolean(latestV3)
    && nowMs - latestPositionMs <= Math.max(60, maxV3AgeSeconds) * 1000;
  const latestVehiclePoints = [...latestByVehicle.values()];
  const newerPolledMovement = [...latestPolledByVehicle].some(([identity, point]) => {
    const vehicleV3 = latestByVehicle.get(identity);
    if (vehicleV3 && timestampMs(point) <= timestampMs(vehicleV3)) return false;
    if (Number(point.speed) > 0) return true;
    const distance = vehicleV3 ? distanceMeters(vehicleV3, point) : null;
    return distance !== null && distance > 30;
  });
  return {
    latestPositionAt,
    fresh,
    // Position Push legitimately stops after an explicit ignition-off report.
    // A fresh V2 collection must not turn that expected silence into a source
    // failure or erase V3's last reported authority. Actual newer V2 movement
    // still exposes a missed V3 stream instead of masking it as a parked truck.
    expectedSilent: latestVehiclePoints.length > 0
      && latestVehiclePoints.every(point => ignitionState(point) === "OFF")
      && !newerPolledMovement,
  };
}

export function selectAuthoritativeLinxupPoint<T extends LinxupPointLike>(
  points: T[],
  nowMs = Date.now(),
  maxV3AgeSeconds = LINXUP_V3_AUTHORITY_MAX_AGE_SECONDS,
): LinxupAuthoritySelection<T> {
  const valid = points.filter(point => Number.isFinite(timestampMs(point)) && timestampMs(point) <= nowMs);
  const latestV3 = latestPoint(valid.filter(isLinxupV3Position));
  const latestV2 = latestPoint(valid.filter((point) => !isLinxupV3Position(point)));
  const latestV3Ms = latestV3 ? timestampMs(latestV3) : Number.NEGATIVE_INFINITY;
  const v3Fresh = Boolean(latestV3)
    && latestV3Ms <= nowMs
    && nowMs - latestV3Ms <= Math.max(60, maxV3AgeSeconds) * 1000;

  if (latestV3 && v3Fresh) {
    return {
      point: latestV3,
      mode: "v3_position_push",
      fallbackActive: false,
      latestV3PositionAt: String(latestV3.timestamp || "") || null,
    };
  }

  // Losing live authority must not rewind the marker to an older observation
  // or erase a push-only truck. Freshness is still based on the point timestamp.
  const lastKnown = latestPoint(valid);
  const polled = lastKnown !== null && lastKnown === latestV2;
  return {
    point: lastKnown,
    mode: polled ? "v2_poll_fallback" : lastKnown ? "last_known" : "unavailable",
    fallbackActive: polled,
    latestV3PositionAt: latestV3 ? String(latestV3.timestamp || "") || null : null,
  };
}
