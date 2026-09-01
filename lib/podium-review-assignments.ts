import fs from "node:fs";
import path from "node:path";
import {
  buildPodiumReviewNameSuggestionMap,
  findPodiumReviewAppointment,
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

export type PodiumReviewAssignmentStore = {
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
    && assignment.attribution?.status === "matched"
    && assignment.attribution.matchMethod === "manual_appointment"
    && Array.isArray(assignment.attribution.crew)
    && assignment.attribution.crew.length > 0,
  );
}

export function readPodiumReviewAssignments(): PodiumReviewManualAssignment[] {
  return readPodiumReviewAssignmentStore().assignments;
}

export function readPodiumReviewAssignmentStore(): PodiumReviewAssignmentStore {
  try {
    const payload = JSON.parse(fs.readFileSync(podiumReviewAssignmentStorePath(), "utf8")) as Partial<PodiumReviewAssignmentStore>;
    return {
      version: 1,
      updatedAt: String(payload.updatedAt || ""),
      assignments: Array.isArray(payload.assignments) ? payload.assignments.filter(validAssignment) : [],
    };
  } catch {
    return { version: 1, updatedAt: "", assignments: [] };
  }
}

function nextTimestamp(...values: string[]): string {
  const latest = values.reduce((maximum, value) => {
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? Math.max(maximum, parsed) : maximum;
  }, 0);
  return new Date(Math.max(Date.now(), latest + 1)).toISOString();
}

function writeAssignments(assignments: PodiumReviewManualAssignment[], updatedAt: string): void {
  const file = podiumReviewAssignmentStorePath();
  const directory = path.dirname(file);
  fs.mkdirSync(directory, { recursive: true, mode: 0o770 });
  const payload: PodiumReviewAssignmentStore = {
    version: 1,
    updatedAt,
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
  const store = readPodiumReviewAssignmentStore();
  const current = store.assignments.find((entry) => entry.reviewUid === String(input.reviewUid || "").trim()) || null;
  return assignPodiumReviewToAppointmentIfCurrent(input, {
    storeUpdatedAt: store.updatedAt,
    assignmentUpdatedAt: current?.assignedAt || "",
  });
}

export function podiumReviewAssignmentForReview(reviewUid: string): PodiumReviewManualAssignment | null {
  const normalized = String(reviewUid || "").trim();
  return readPodiumReviewAssignmentStore().assignments.find((entry) => entry.reviewUid === normalized) || null;
}

export function assignPodiumReviewToAppointmentIfCurrent(input: {
  reviewUid: string;
  appointmentReference: string;
  assignedBy: string;
}, expected: {
  storeUpdatedAt: string;
  assignmentUpdatedAt: string;
}): PodiumReviewManualAssignment | null {
  const reviewUid = String(input.reviewUid || "").trim();
  const attribution = findPodiumReviewAppointment(
    podiumReviewAssignmentDataDirectory(),
    input.appointmentReference,
  );
  if (!reviewUid || !attribution) return null;
  const store = readPodiumReviewAssignmentStore();
  if (store.updatedAt !== expected.storeUpdatedAt) {
    throw new Error("VERSION_CONFLICT: Podium review assignment state changed after this request was prepared.");
  }
  const current = store.assignments.find((entry) => entry.reviewUid === reviewUid) || null;
  if (String(current?.assignedAt || "") !== expected.assignmentUpdatedAt) {
    throw new Error("VERSION_CONFLICT: The Podium review assignment changed after this request was prepared.");
  }
  const assignedAt = nextTimestamp(store.updatedAt, current?.assignedAt || "");
  const assignment: PodiumReviewManualAssignment = {
    reviewUid,
    attribution,
    assignedAt,
    assignedBy: String(input.assignedBy || "").trim(),
  };
  const remaining = store.assignments.filter((entry) => entry.reviewUid !== reviewUid);
  writeAssignments([...remaining, assignment], assignedAt);
  return assignment;
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
