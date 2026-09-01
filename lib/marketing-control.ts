import crypto from "node:crypto";
import type { ActionVerification } from "@/lib/platform/contracts";
import { getPodiumConfig } from "@/lib/podium-config";
import {
  assignPodiumReviewToAppointmentIfCurrent,
  podiumReviewAssignmentForReview,
  podiumReviewAssignmentOptions,
  podiumReviewNameSuggestions,
  readPodiumReviewAssignmentStore,
} from "@/lib/podium-review-assignments";
import {
  findPodiumReviewAppointment,
  type PodiumReviewAppointmentAttribution,
  type PodiumReviewAssignmentOption,
  type PodiumReviewNameSuggestion,
} from "@/lib/podium-review-attribution";
import {
  buildPodiumGoogleReviewsView,
  readPodiumGoogleReviewsSnapshot,
  type PodiumReviewSnapshotItem,
} from "@/lib/podium-reviews";
import { podiumTokenStoreStatus } from "@/lib/podium-token-store";
import { getOpsRuntime } from "@/lib/runtime";

export type MarketingControlMode = "live_control" | "preview_simulation";
export type PodiumAttributionMode = "confirm_suggestion" | "reassign";

export type MarketingPodiumCandidate = {
  reference: string;
  appointmentId: string;
  jkNumber: string;
  appointmentDate: string;
  customerName: string;
  territory: string;
  truck: string;
  crew: string[];
  candidateKey: string;
  matchKind?: PodiumReviewNameSuggestion["matchKind"];
};

export type MarketingPodiumReview = {
  reviewUid: string;
  authorName: string;
  body: string;
  rating: number;
  createdAt: string;
  updatedAt: string;
  locationName: string;
  needsResponse: boolean;
  suggestions: MarketingPodiumCandidate[];
};

export type MarketingControlSnapshot = {
  date: string;
  mode: MarketingControlMode;
  source: "Podium Reviews + JunkWare completed appointments";
  sourceObservedAt: string;
  podium: {
    connected: boolean;
    scopes: readonly string[];
    snapshotAvailable: boolean;
    snapshotFetchedAt: string;
    locations: number;
    pendingAttribution: number;
    recentNeedsResponse: number;
    assignmentStoreUpdatedAt: string;
    reviews: MarketingPodiumReview[];
    assignmentOptions: MarketingPodiumCandidate[];
  };
  authorityNotice: string;
};

export type PodiumReviewAttributionInput = {
  reviewUid: string;
  appointmentReference: string;
  assignmentMode: PodiumAttributionMode;
  expectedSnapshotFetchedAt: string;
  expectedReviewUpdatedAt: string;
  expectedAssignmentStoreUpdatedAt: string;
  expectedAssignmentUpdatedAt: string;
  expectedCandidateKey: string;
  expectedCandidateAppointmentId: string;
  expectedCandidateJkNumber: string;
  expectedCandidateCrew: string[];
};

export type PodiumReviewAttributionReceipt = {
  mode: MarketingControlMode;
  reviewUid: string;
  assignmentId: string;
  changed: boolean;
  verified: boolean;
  summary: string;
  evidence: Record<string, unknown>;
};

function clean(value: unknown): string {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function dataRoot(): string {
  return clean(process.env.OPSBOT_DATA_DIR) || `${process.cwd()}/data`;
}

export function marketingControlMode(): MarketingControlMode {
  return getOpsRuntime() === "MISSION_CONTROL" ? "live_control" : "preview_simulation";
}

function candidateKey(value: Pick<PodiumReviewAppointmentAttribution, "appointmentId" | "jkNumber" | "appointmentDate" | "territory" | "truck" | "crew">): string {
  return crypto.createHash("sha256").update(JSON.stringify({
    appointmentId: clean(value.appointmentId),
    jkNumber: clean(value.jkNumber),
    appointmentDate: clean(value.appointmentDate),
    territory: clean(value.territory),
    truck: clean(value.truck),
    crew: (value.crew || []).map(clean).filter(Boolean).sort(),
  })).digest("hex");
}

function candidateView(
  value: PodiumReviewAssignmentOption | PodiumReviewNameSuggestion,
): MarketingPodiumCandidate {
  return {
    reference: value.reference,
    appointmentId: value.appointmentId,
    jkNumber: value.jkNumber,
    appointmentDate: value.appointmentDate,
    customerName: value.customerName,
    territory: value.territory,
    truck: value.truck,
    crew: value.crew,
    candidateKey: candidateKey(value),
    ...(Object.prototype.hasOwnProperty.call(value, "matchKind")
      ? { matchKind: (value as PodiumReviewNameSuggestion).matchKind }
      : {}),
  };
}

function snapshotReview(reviewUid: string): { review: PodiumReviewSnapshotItem; locationName: string } | null {
  const snapshot = readPodiumGoogleReviewsSnapshot();
  for (const location of snapshot?.locations || []) {
    const review = location.reviews.find((candidate) => candidate.uid === reviewUid);
    if (review) return { review, locationName: location.name };
  }
  return null;
}

function earliestAssignmentDate(fetchedAt: string): string {
  const timestamp = Date.parse(fetchedAt);
  return Number.isFinite(timestamp)
    ? new Date(timestamp - 120 * 86_400_000).toISOString().slice(0, 10)
    : "";
}

export function readMarketingControlSnapshot(date: string): MarketingControlSnapshot {
  const view = buildPodiumGoogleReviewsView();
  const config = getPodiumConfig();
  const token = podiumTokenStoreStatus();
  const assignmentStore = readPodiumReviewAssignmentStore();
  const suggestionsByReview = podiumReviewNameSuggestions(view.unassigned30Days);
  const reviews = view.unassigned30Days.map((review): MarketingPodiumReview => ({
    reviewUid: review.uid,
    authorName: review.authorName,
    body: review.body,
    rating: review.rating,
    createdAt: review.createdAt,
    updatedAt: review.updatedAt,
    locationName: review.locationName,
    needsResponse: review.needsResponse,
    suggestions: (suggestionsByReview[review.uid] || []).map(candidateView),
  }));
  const assignmentOptions = podiumReviewAssignmentOptions(
    earliestAssignmentDate(view.snapshot?.fetchedAt || ""),
  ).slice(0, 600).map(candidateView);
  return {
    date,
    mode: marketingControlMode(),
    source: "Podium Reviews + JunkWare completed appointments",
    sourceObservedAt: [view.snapshot?.fetchedAt || "", assignmentStore.updatedAt].filter(Boolean).sort().at(-1) || "",
    podium: {
      connected: config.ready && token.connected,
      scopes: config.scopes,
      snapshotAvailable: Boolean(view.snapshot),
      snapshotFetchedAt: view.snapshot?.fetchedAt || "",
      locations: view.locations.length,
      pendingAttribution: view.pendingAttribution30Days,
      recentNeedsResponse: view.recentNeedsResponse,
      assignmentStoreUpdatedAt: assignmentStore.updatedAt,
      reviews,
      assignmentOptions,
    },
    authorityNotice: "Attribution changes only OpsCenter review credit and reporting. It never replies to the customer, changes the Podium review, edits the JunkWare appointment, or expands the approved read_reviews and read_locations scopes.",
  };
}

export function preparePodiumReviewAttributionInput(
  reviewUidValue: string,
  appointmentReferenceValue: string,
  requestedMode?: PodiumAttributionMode,
): PodiumReviewAttributionInput {
  const reviewUid = clean(reviewUidValue);
  const appointmentReference = clean(appointmentReferenceValue);
  const snapshot = readPodiumGoogleReviewsSnapshot();
  const located = snapshotReview(reviewUid);
  if (!snapshot || !located) throw new Error("The current Podium review is unavailable.");
  const attribution = findPodiumReviewAppointment(dataRoot(), appointmentReference);
  if (!attribution) throw new Error("No completed JunkWare job with recorded crew matched that appointment ID or JK number.");
  const suggestionInputs = [{
    uid: reviewUid,
    authorName: located.review.authorName,
    createdAt: located.review.createdAt,
    locationName: located.locationName,
  }];
  const suggestions = podiumReviewNameSuggestions(suggestionInputs)[reviewUid] || [];
  const isSuggestion = suggestions.some((candidate) => candidate.reference === appointmentReference
    || candidate.appointmentId === appointmentReference
    || candidate.jkNumber === appointmentReference);
  const assignmentMode = requestedMode || (isSuggestion ? "confirm_suggestion" : "reassign");
  if (assignmentMode === "confirm_suggestion" && !isSuggestion) {
    throw new Error("The selected appointment is no longer a current review suggestion. Choose re-assign to use it explicitly.");
  }
  const store = readPodiumReviewAssignmentStore();
  const current = podiumReviewAssignmentForReview(reviewUid);
  return {
    reviewUid,
    appointmentReference,
    assignmentMode,
    expectedSnapshotFetchedAt: snapshot.fetchedAt,
    expectedReviewUpdatedAt: located.review.updatedAt,
    expectedAssignmentStoreUpdatedAt: store.updatedAt,
    expectedAssignmentUpdatedAt: current?.assignedAt || "",
    expectedCandidateKey: candidateKey(attribution),
    expectedCandidateAppointmentId: clean(attribution.appointmentId),
    expectedCandidateJkNumber: clean(attribution.jkNumber),
    expectedCandidateCrew: (attribution.crew || []).map(clean).filter(Boolean),
  };
}

function assertCurrentAttribution(input: PodiumReviewAttributionInput): PodiumReviewAppointmentAttribution {
  const snapshot = readPodiumGoogleReviewsSnapshot();
  const located = snapshotReview(input.reviewUid);
  if (!snapshot || snapshot.fetchedAt !== input.expectedSnapshotFetchedAt || !located) {
    throw new Error("VERSION_CONFLICT: The Podium review snapshot changed after this request was prepared.");
  }
  if (located.review.updatedAt !== input.expectedReviewUpdatedAt) {
    throw new Error("VERSION_CONFLICT: The Podium review changed after this request was prepared.");
  }
  const store = readPodiumReviewAssignmentStore();
  const current = podiumReviewAssignmentForReview(input.reviewUid);
  if (store.updatedAt !== input.expectedAssignmentStoreUpdatedAt
    || String(current?.assignedAt || "") !== input.expectedAssignmentUpdatedAt) {
    throw new Error("VERSION_CONFLICT: The Podium review assignment changed after this request was prepared.");
  }
  const attribution = findPodiumReviewAppointment(dataRoot(), input.appointmentReference);
  if (!attribution || candidateKey(attribution) !== input.expectedCandidateKey) {
    throw new Error("VERSION_CONFLICT: The completed JunkWare appointment evidence changed after this request was prepared.");
  }
  if (input.assignmentMode === "confirm_suggestion") {
    preparePodiumReviewAttributionInput(input.reviewUid, input.appointmentReference, "confirm_suggestion");
  }
  return attribution;
}

export async function executePodiumReviewAttribution(
  input: PodiumReviewAttributionInput,
  actorLabel = "Approved OpsCenter marketing manager",
): Promise<PodiumReviewAttributionReceipt> {
  const attribution = assertCurrentAttribution(input);
  const evidence = {
    reviewUid: input.reviewUid,
    assignmentMode: input.assignmentMode,
    appointmentId: attribution.appointmentId || "",
    jkNumber: attribution.jkNumber || "",
    appointmentDate: attribution.appointmentDate || "",
    crew: attribution.crew || [],
    podiumSnapshotFetchedAt: input.expectedSnapshotFetchedAt,
    candidateKey: input.expectedCandidateKey,
  };
  const mode = marketingControlMode();
  if (mode === "preview_simulation") {
    return {
      mode,
      reviewUid: input.reviewUid,
      assignmentId: "preview-simulation",
      changed: true,
      verified: true,
      summary: "Preview simulation verified; no Podium review, JunkWare appointment, customer response, or shared attribution was changed.",
      evidence,
    };
  }
  const assignment = assignPodiumReviewToAppointmentIfCurrent({
    reviewUid: input.reviewUid,
    appointmentReference: input.appointmentReference,
    assignedBy: actorLabel,
  }, {
    storeUpdatedAt: input.expectedAssignmentStoreUpdatedAt,
    assignmentUpdatedAt: input.expectedAssignmentUpdatedAt,
  });
  if (!assignment) throw new Error("The Podium review assignment could not be recorded.");
  return {
    mode,
    reviewUid: assignment.reviewUid,
    assignmentId: assignment.assignedAt,
    changed: true,
    verified: true,
    summary: `Podium review attribution to ${assignment.attribution.jkNumber || assignment.attribution.appointmentId} verified in OpsCenter reporting state.`,
    evidence: { ...evidence, assignedAt: assignment.assignedAt },
  };
}

export async function verifyPodiumReviewAttribution(
  receipt: PodiumReviewAttributionReceipt,
  input: PodiumReviewAttributionInput,
): Promise<ActionVerification> {
  if (receipt.mode === "preview_simulation") {
    return { outcome: "verified", verifiedAt: new Date().toISOString(), summary: receipt.summary, evidence: receipt.evidence };
  }
  const assignment = podiumReviewAssignmentForReview(input.reviewUid);
  if (!assignment
    || assignment.assignedAt !== receipt.assignmentId
    || candidateKey(assignment.attribution) !== input.expectedCandidateKey
    || assignment.attribution.appointmentId !== input.expectedCandidateAppointmentId
    || assignment.attribution.jkNumber !== input.expectedCandidateJkNumber) {
    return { outcome: "mismatch", summary: "The saved Podium attribution does not match the approved review and completed-job evidence." };
  }
  return {
    outcome: "verified",
    verifiedAt: assignment.assignedAt,
    summary: receipt.summary,
    evidence: { ...receipt.evidence, assignedAt: assignment.assignedAt },
  };
}
