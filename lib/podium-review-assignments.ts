import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import {
  buildPodiumReviewNameSuggestionMap,
  findPodiumReviewAppointment,
  inferredHighAttribution,
  listPodiumReviewAssignmentOptions,
  type PodiumReviewAppointmentAttribution,
  type PodiumReviewAssignmentOption,
  type PodiumReviewNameSuggestion,
  type PodiumReviewNameSuggestionInput,
} from "@/lib/podium-review-attribution";

export type PodiumReviewManualAssignment = {
  reviewUid: string;
  attribution: PodiumReviewAppointmentAttribution;
  assignedAt: string;
  assignedBy: string;
};

type PodiumReviewAssignmentStore = {
  version: 1;
  updatedAt: string;
  assignments: PodiumReviewManualAssignment[];
};

function dataRoots(): string[] {
  return [
    String(process.env.OPSBOT_DATA_DIR || "").trim(),
    path.join(process.cwd(), "data"),
    path.join(process.env.HOME || "", ".openclaw", "workspace", "opsbot", "data"),
  ].filter(Boolean);
}

export function podiumReviewAssignmentDataDirectory(): string {
  return dataRoots().find((root) => fs.existsSync(path.join(root, "processed")))
    || dataRoots()[0]
    || path.join(process.cwd(), "data");
}

export function podiumReviewAssignmentStorePath(): string {
  return String(process.env.PODIUM_REVIEW_ASSIGNMENT_STORE || "").trim()
    || path.join(podiumReviewAssignmentDataDirectory(), "operator", "podium_review_assignments.json");
}

function validAssignment(value: unknown): value is PodiumReviewManualAssignment {
  const assignment = value as PodiumReviewManualAssignment | null;
  return Boolean(
    assignment
    && typeof assignment.reviewUid === "string"
    && assignment.reviewUid.trim()
    && ((assignment.attribution?.status === "unmatched" && assignment.attribution.matchMethod === "manual_unassigned")
      || (assignment.attribution?.status === "matched"
        && ["manual_appointment", "inferred_high", "exact_phone", "exact_email"].includes(assignment.attribution.matchMethod || "")
        && Array.isArray(assignment.attribution.crew) && assignment.attribution.crew.length > 0)),
  );
}

export function readPodiumReviewAssignments(file = podiumReviewAssignmentStorePath()): PodiumReviewManualAssignment[] {
  try {
    const payload = JSON.parse(fs.readFileSync(file, "utf8")) as Partial<PodiumReviewAssignmentStore>;
    if (payload.version !== 1 || !Array.isArray(payload.assignments) || !payload.assignments.every(validAssignment)) throw new Error("Review assignment store is unreadable.");
    return payload.assignments;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw new Error("Review assignment store is unreadable; no assignments were changed.");
  }
}

function writeAssignments(assignments: PodiumReviewManualAssignment[], file = podiumReviewAssignmentStorePath()): void {
  const directory = path.dirname(file);
  fs.mkdirSync(directory, { recursive: true, mode: 0o770 });
  const payload: PodiumReviewAssignmentStore = {
    version: 1,
    updatedAt: new Date().toISOString(),
    assignments: [...assignments].sort((left, right) => left.reviewUid.localeCompare(right.reviewUid)),
  };
  const temporary = path.join(directory, `.${path.basename(file)}.${process.pid}.${Date.now()}.tmp`);
  fs.writeFileSync(temporary, `${JSON.stringify(payload, null, 2)}\n`, { encoding: "utf8", mode: 0o660 });
  fs.chmodSync(temporary, 0o660);
  fs.renameSync(temporary, file);
}

export function assignPodiumReviewToAppointment(input: {
  reviewUid: string;
  appointmentReference: string;
  assignedBy: string;
}): PodiumReviewManualAssignment | null {
  const reviewUid = String(input.reviewUid || "").trim();
  const attribution = findPodiumReviewAppointment(
    podiumReviewAssignmentDataDirectory(),
    input.appointmentReference,
  );
  if (!reviewUid || !attribution) return null;
  const assignment: PodiumReviewManualAssignment = {
    reviewUid,
    attribution,
    assignedAt: new Date().toISOString(),
    assignedBy: String(input.assignedBy || "").trim(),
  };
  return withAssignmentLock(podiumReviewAssignmentStorePath(), () => {
    const remaining = readPodiumReviewAssignments().filter((entry) => entry.reviewUid !== reviewUid);
    writeAssignments([...remaining, assignment]);
    return assignment;
  });
}

export function podiumReviewAssignmentMap(): Map<string, PodiumReviewManualAssignment> {
  return new Map(readPodiumReviewAssignments().map((assignment) => [assignment.reviewUid, assignment]));
}

export function podiumReviewAssignmentOptions(earliestDate = ""): PodiumReviewAssignmentOption[] {
  return listPodiumReviewAssignmentOptions(podiumReviewAssignmentDataDirectory(), earliestDate);
}

export function podiumReviewNameSuggestions(
  reviews: PodiumReviewNameSuggestionInput[],
): Record<string, PodiumReviewNameSuggestion[]> {
  return buildPodiumReviewNameSuggestionMap(podiumReviewAssignmentDataDirectory(), reviews);
}

// Shared by the collector, desktop and legacy assignment endpoint. Atomic rename
// alone cannot stop a collector read/modify/write from losing a manager change.
export const REVIEW_ASSIGNMENT_LOCK_STALE_MS = 5 * 60_000;

function recoverAssignmentLock(lock: string): void {
  try {
    const stat = fs.statSync(lock);
    if (Date.now() - stat.mtimeMs < REVIEW_ASSIGNMENT_LOCK_STALE_MS) return;
    const entries = fs.readdirSync(lock);
    if (entries.length === 0) {
      // Legacy/crash-before-metadata lock. New locks publish owner metadata
      // atomically, so rmdir can never remove a newly acquired nonempty lock.
      fs.rmdirSync(lock);
      return;
    }
    if (entries.length !== 1 || !/^owner-[a-f0-9-]+\.json$/.test(entries[0])) return;
    const owner = JSON.parse(fs.readFileSync(path.join(lock, entries[0]), "utf8"));
    if (!Number.isSafeInteger(owner.pid) || owner.pid <= 0 || !Number.isFinite(owner.createdAt)
      || Date.now() - owner.createdAt < REVIEW_ASSIGNMENT_LOCK_STALE_MS) return;
    try { process.kill(owner.pid, 0); return; } catch (error) {
      // EPERM/unknown means possibly alive. Never evict an active owner by age.
      if ((error as NodeJS.ErrnoException).code !== "ESRCH") return;
    }
    // Only the reclaimer that unlinks this unique owner's marker may rmdir.
    // A competing/new owner has a different marker and a nonempty directory.
    fs.unlinkSync(path.join(lock, entries[0]));
    fs.rmdirSync(lock);
  } catch { /* Contention or unknown ownership: fail closed at acquisition. */ }
}

function withAssignmentLock<T>(file: string, write: () => T): T {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o770 });
  const lock = `${file}.lock`;
  const token = randomUUID();
  const marker = `owner-${token}.json`;
  const staging = `${lock}.${token}.pending`;
  fs.mkdirSync(staging, { mode: 0o770 });
  let acquired = false;
  try {
    fs.writeFileSync(path.join(staging, marker), JSON.stringify({ pid: process.pid, createdAt: Date.now() }), { mode: 0o660 });
    recoverAssignmentLock(lock);
    if (fs.existsSync(lock)) throw new Error("Another review assignment is in progress or requires recovery.");
    try {
      // rename publishes a nonempty lock atomically. Competing nonempty locks
      // cannot replace each other, including during stale-lock recovery.
      fs.renameSync(staging, lock);
      acquired = true;
    } catch { throw new Error("Another review assignment is in progress or requires recovery."); }
    return write();
  } finally {
    const directory = acquired ? lock : staging;
    try { fs.unlinkSync(path.join(directory, marker)); } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    try { fs.rmdirSync(directory); } catch (error) {
      // Another process may have acquired the released, now-empty directory.
      if (!["ENOENT", "ENOTEMPTY", "EEXIST"].includes((error as NodeJS.ErrnoException).code || "")) throw error;
    }
  }
}

export function undoPodiumReviewAutoMatch(reviewUid: string, assignedBy: string): boolean {
  return withAssignmentLock(podiumReviewAssignmentStorePath(), () => {
    const assignments = readPodiumReviewAssignments();
    const current = assignments.find(entry => entry.reviewUid === reviewUid);
    if (current?.attribution.matchMethod !== "inferred_high") return false;
    // Tombstone survives future collections; a manager action always wins.
    const replacement: PodiumReviewManualAssignment = {
      reviewUid, assignedBy, assignedAt: new Date().toISOString(),
      attribution: { status: "unmatched", matchMethod: "manual_unassigned" },
    };
    writeAssignments([...assignments.filter(entry => entry.reviewUid !== reviewUid), replacement]);
    return readPodiumReviewAssignments().some(entry => entry.reviewUid === reviewUid && entry.attribution.matchMethod === "manual_unassigned");
  });
}

/** Default-off rollout gate. Enable only in the reviewed deployed release. */
export function podiumHighAutoSaveEnabled(): boolean {
  return process.env.PODIUM_REVIEW_HIGH_AUTO_SAVE === "true";
}

export function savePodiumHighConfidenceMatches(
  dataDir: string,
  reviews: Array<PodiumReviewNameSuggestionInput & { attribution?: PodiumReviewAppointmentAttribution }>,
  file = path.join(dataDir, "operator", "podium_review_assignments.json"),
): number {
  if (!podiumHighAutoSaveEnabled()) return 0;
  const suggestions = buildPodiumReviewNameSuggestionMap(dataDir, reviews);
  return withAssignmentLock(file, () => {
    const assignments = readPodiumReviewAssignments(file);
    const saved = new Set(assignments.map(entry => entry.reviewUid));
    let count = 0;
    for (const review of reviews) {
      // Preserve every prior decision, including undo and exact collector matches.
      if (saved.has(review.uid) || review.attribution?.status === "matched" || review.attribution?.matchMethod === "manual_unassigned") continue;
      const suggestion = suggestions[review.uid]?.[0];
      if (suggestion?.confidence !== "High") continue;
      assignments.push({ reviewUid: review.uid, assignedBy: "opscenter:review-matcher", assignedAt: new Date().toISOString(), attribution: inferredHighAttribution(suggestion) });
      saved.add(review.uid); count++;
    }
    if (count) writeAssignments(assignments, file);
    return count;
  });
}
