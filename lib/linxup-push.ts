import crypto from "node:crypto";
import { LINXUP_PUSH_API_PREFIX } from "@/lib/linxup-push-constants";

export { LINXUP_PUSH_API_PREFIX };

export type LinxupV3Position = Record<string, unknown> & {
  date: number;
  positionDate: number;
  latitude: number;
  longitude: number;
  tracker: Record<string, unknown>;
};

export function linxupBearerToken(request: Request): string {
  const authorization = String(request.headers.get("authorization") || "");
  return authorization.startsWith("Bearer ") ? authorization.slice("Bearer ".length).trim() : "";
}

export function validLinxupPushToken(actual: string): boolean {
  const expected = String(process.env.LINXUP_PUSH_BEARER_TOKEN || "").trim();
  const actualBytes = Buffer.from(actual);
  const expectedBytes = Buffer.from(expected);
  return Boolean(expected)
    && actualBytes.length === expectedBytes.length
    && crypto.timingSafeEqual(actualBytes, expectedBytes);
}

export function normalizeLinxupV3Position(value: unknown, nowMs = Date.now()): LinxupV3Position | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  const positionDate = Number(record.date ?? record.positionDate);
  const latitude = Number(record.latitude);
  const longitude = Number(record.longitude);
  const tracker = record.tracker && typeof record.tracker === "object"
    ? record.tracker as Record<string, unknown>
    : null;
  const trackerId = String(tracker?.trackerId ?? tracker?.id ?? "").trim();
  const trackerName = String(tracker?.name ?? "").trim();
  if (!Number.isFinite(positionDate)
    || positionDate <= 0
    || positionDate > nowMs + 5 * 60 * 1000
    || !Number.isFinite(latitude)
    || latitude < -90
    || latitude > 90
    || !Number.isFinite(longitude)
    || longitude < -180
    || longitude > 180
    || !tracker
    || (!trackerId && !trackerName)) return null;

  return {
    ...record,
    date: positionDate,
    positionDate,
    latitude,
    longitude,
    tracker,
  };
}

export function isLinxupPosition(value: unknown): boolean {
  return Boolean(normalizeLinxupV3Position(value));
}
