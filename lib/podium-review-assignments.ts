import fs from "node:fs";
import path from "node:path";
import {
  findPodiumReviewAppointment,
  listPodiumReviewAssignmentOptions,
  type PodiumReviewAppointmentAttribution,
  type PodiumReviewAssignmentOption,
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
    && assignment.attribution?.status === "matched"
    && assignment.attribution.matchMethod === "manual_appointment"
    && Array.isArray(assignment.attribution.crew)
    && assignment.attribution.crew.length > 0,
  );
}

export function readPodiumReviewAssignments(): PodiumReviewManualAssignment[] {
  try {
    const payload = JSON.parse(fs.readFileSync(podiumReviewAssignmentStorePath(), "utf8")) as Partial<PodiumReviewAssignmentStore>;
    return Array.isArray(payload.assignments) ? payload.assignments.filter(validAssignment) : [];
  } catch {
    return [];
  }
}

function writeAssignments(assignments: PodiumReviewManualAssignment[]): void {
  const file = podiumReviewAssignmentStorePath();
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
  const remaining = readPodiumReviewAssignments().filter((entry) => entry.reviewUid !== reviewUid);
  writeAssignments([...remaining, assignment]);
  return assignment;
}

export function podiumReviewAssignmentMap(): Map<string, PodiumReviewManualAssignment> {
  return new Map(readPodiumReviewAssignments().map((assignment) => [assignment.reviewUid, assignment]));
}

export function podiumReviewAssignmentOptions(earliestDate = ""): PodiumReviewAssignmentOption[] {
  return listPodiumReviewAssignmentOptions(podiumReviewAssignmentDataDirectory(), earliestDate);
}
