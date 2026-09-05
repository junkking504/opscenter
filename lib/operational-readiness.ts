import fs from "node:fs";
import { sourceFreshness, CREW_PORTAL_MAX_AGE_SECONDS } from "@/lib/source-freshness";
import path from "node:path";
import { getOpsAuthReadiness } from "@/lib/auth";

type PhotoQueueName = "incoming" | "processing" | "completed" | "review" | "failed";

export type OperationalReadiness = {
  ok: boolean;
  status: "ready" | "attention";
  auth: ReturnType<typeof getOpsAuthReadiness>;
  photoQueue: {
    ok: boolean;
    counts: Record<PhotoQueueName, number>;
    reasons: Record<string, number>;
    available: boolean;
    oldestUnresolvedAt: string | null;
    olderThan24Hours: number;
  };
  crewPortalSync: {
    ok: boolean;
    status: "unknown" | "synchronized" | "failed";
    lastAttemptAt: string | null;
    lastSuccessAt: string | null;
    error: string | null;
    fresh: boolean;
    ageSeconds: number | null;
    maxAgeSeconds: number;
  };
};

const PHOTO_QUEUE_NAMES: PhotoQueueName[] = ["incoming", "processing", "completed", "review", "failed"];

function jsonFileCount(directory: string): number {
  try {
    return fs.readdirSync(directory).filter((name) => name.endsWith(".json")).length;
  } catch {
    return 0;
  }
}

function readPhotoReasons(directory: string): Record<string, number> {
  const reasons: Record<string, number> = {};
  try {
    for (const name of fs.readdirSync(directory).filter((entry) => entry.endsWith(".json"))) {
      try {
        const payload = JSON.parse(fs.readFileSync(path.join(directory, name), "utf8")) as {
          review?: { reason?: unknown };
          error?: unknown;
          lastError?: unknown;
        };
        const reason = String(payload.review?.reason || payload.error || payload.lastError || "operator_review_required")
          .trim()
          .slice(0, 120) || "operator_review_required";
        reasons[reason] = (reasons[reason] || 0) + 1;
      } catch {
        reasons.unreadable_queue_record = (reasons.unreadable_queue_record || 0) + 1;
      }
    }
  } catch {
    reasons.queue_unreadable = 1;
  }
  return reasons;
}

function readCrewPortalSync(dataDirectory: string, now: number): OperationalReadiness["crewPortalSync"] {
  const statusFile = path.join(dataDirectory, "integrations", "crew-portal-sync", "status.json");
  try {
    const payload = JSON.parse(fs.readFileSync(statusFile, "utf8")) as {
      status?: unknown;
      lastAttemptAt?: unknown;
      lastSuccessAt?: unknown;
      error?: unknown;
    };
    const status = payload.status === "synchronized" ? "synchronized" : "failed";
    const freshness = sourceFreshness(String(payload.lastSuccessAt || ''), CREW_PORTAL_MAX_AGE_SECONDS, now);
    return {
      ...freshness,
      ok: status === "synchronized" && freshness.fresh,
      status,
      lastAttemptAt: String(payload.lastAttemptAt || "").trim() || null,
      lastSuccessAt: String(payload.lastSuccessAt || "").trim() || null,
      error: String(payload.error || "").trim() || null,
    };
  } catch {
    return { ...sourceFreshness(null, CREW_PORTAL_MAX_AGE_SECONDS, now), ok: false, status: "unknown", lastAttemptAt: null, lastSuccessAt: null, error: null };
  }
}

export function getOperationalReadiness(dataDirectory = path.join(process.cwd(), "data"), now = Date.now()): OperationalReadiness {
  const auth = getOpsAuthReadiness();
  const photoRoot = String(process.env.WHATSAPP_JOB_PHOTO_STATE_DIR || "").trim()
    || path.join(dataDirectory, "integrations", "whatsapp-job-photos");
  const counts = Object.fromEntries(
    PHOTO_QUEUE_NAMES.map((name) => [name, jsonFileCount(path.join(photoRoot, name))]),
  ) as Record<PhotoQueueName, number>;
  const reasons = {
    ...readPhotoReasons(path.join(photoRoot, "review")),
    ...Object.fromEntries(Object.entries(readPhotoReasons(path.join(photoRoot, "failed"))).map(([reason, count]) => [`failed:${reason}`, count])),
  };
  const available = PHOTO_QUEUE_NAMES.every(name => { try { fs.accessSync(path.join(photoRoot, name), fs.constants.R_OK); return fs.statSync(path.join(photoRoot, name)).isDirectory(); } catch { return false; } });
  const unresolvedTimes = ['incoming','processing','review','failed'].flatMap(name => {
    try { return fs.readdirSync(path.join(photoRoot,name)).filter(file => file.endsWith('.json')).flatMap(file => { try { return [fs.statSync(path.join(photoRoot,name,file)).mtimeMs]; } catch { return []; } }); } catch { return []; }
  });
  const photoQueue = {
    available,
    oldestUnresolvedAt: unresolvedTimes.length ? new Date(Math.min(...unresolvedTimes)).toISOString() : null,
    olderThan24Hours: unresolvedTimes.filter(time => now - time > 86400000).length,
    ok: available && !Object.keys(reasons).some(reason => /unreadable/.test(reason)) && counts.incoming === 0 && counts.processing === 0 && counts.review === 0 && counts.failed === 0,
    counts,
    reasons,
  };
  const crewPortalSync = readCrewPortalSync(dataDirectory, now);
  const ok = auth.ok && photoQueue.ok && crewPortalSync.ok;
  return { ok, status: ok ? "ready" : "attention", auth, photoQueue, crewPortalSync };
}
