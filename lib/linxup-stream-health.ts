import fs from "node:fs";
import path from "node:path";
import { summarizeLinxupV3Stream, type LinxupPointLike } from "./linxup-authority";

function readPoints(file: string, date: string): LinxupPointLike[] {
  const payload = JSON.parse(fs.readFileSync(file, "utf8"));
  if (payload?.date !== date || !Array.isArray(payload.points)
    || payload.points.some((point: unknown) => !point || typeof point !== "object" || Array.isArray(point))) {
    throw new Error("Invalid daily GPS snapshot");
  }
  return payload.points;
}

/** Read-only delivery evidence across one operating-day boundary, never new travel. */
export function readLinxupV3StreamState(file: string, maxV3AgeSeconds: number, nowMs = Date.now()) {
  try {
    const day = /^linxup_location_(\d{4}-\d{2}-\d{2})\.json$/.exec(path.basename(file))?.[1];
    if (!day) throw new Error("Invalid GPS snapshot name");
    const dateMs = Date.parse(`${day}T00:00:00Z`);
    if (!Number.isFinite(dateMs) || new Date(dateMs).toISOString().slice(0, 10) !== day) throw new Error("Invalid GPS day");
    const current = readPoints(file, day);
    // Daily files rotate at Chicago midnight. A parked tracker need not send
    // another V3 point then. Carry the preceding day's actual observations,
    // including V2 movement that must still defeat expected-silence treatment.
    const previousDay = new Date(dateMs - 86_400_000).toISOString().slice(0, 10);
    let previous: LinxupPointLike[] = [];
    try {
      previous = readPoints(path.join(path.dirname(file), `linxup_location_${previousDay}.json`), previousDay);
    } catch { /* Missing/damaged history cannot supply ignition-off evidence. */ }
    // Prefer the current snapshot for equal-time per-vehicle observations.
    return summarizeLinxupV3Stream([...current, ...previous], nowMs, maxV3AgeSeconds);
  } catch {
    return { latestPositionAt: null, fresh: false, expectedSilent: false };
  }
}
