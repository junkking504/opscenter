import crypto from "node:crypto";
import { LINXUP_PUSH_API_PREFIX } from "@/lib/linxup-push-constants";

export { LINXUP_PUSH_API_PREFIX };

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

export function isLinxupPosition(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  return Number.isFinite(Number(record.positionDate))
    && Number.isFinite(Number(record.latitude))
    && Number.isFinite(Number(record.longitude));
}
