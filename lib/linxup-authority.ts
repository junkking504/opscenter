export const LINXUP_V3_AUTHORITY_MAX_AGE_SECONDS = 180;

export type LinxupDeliveryMode = "v3_position_push" | "v2_poll_fallback" | "unavailable";

export type LinxupPointLike = {
  timestamp?: unknown;
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
    !latest || timestampMs(point) > timestampMs(latest) ? point : latest
  ), null);
}

export function selectAuthoritativeLinxupPoint<T extends LinxupPointLike>(
  points: T[],
  nowMs = Date.now(),
  maxV3AgeSeconds = LINXUP_V3_AUTHORITY_MAX_AGE_SECONDS,
): LinxupAuthoritySelection<T> {
  const latestV3 = latestPoint(points.filter(isLinxupV3Position));
  const latestV2 = latestPoint(points.filter((point) => !isLinxupV3Position(point)));
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

  return {
    point: latestV2,
    mode: latestV2 ? "v2_poll_fallback" : "unavailable",
    fallbackActive: Boolean(latestV2),
    latestV3PositionAt: latestV3 ? String(latestV3.timestamp || "") || null : null,
  };
}
