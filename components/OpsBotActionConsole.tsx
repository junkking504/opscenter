"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { ActionRun } from "@/lib/platform/contracts";
import type { InboxPayload, InboxWorkItem } from "@/lib/platform/inbox";
import JobCloseoutEditor from "./JobCloseoutEditor";
import styles from "./OpsBotActionConsole.module.css";

type ActionSnapshot = {
  runs: ActionRun[];
  summary: {
    total: number;
    awaitingApproval: number;
    executing: number;
    succeeded: number;
    failed: number;
  };
};

type DispatchAppointment = {
  appointmentId: string;
  jobKey: string;
  jkNumber: string;
  customerName: string;
  appointmentTime: string;
  appointmentStartMinutes: number | null;
  appointmentEndMinutes: number | null;
  appointmentType: string;
  status: string;
  territory: string;
  sourceTruck: string;
  effectiveTruck: string;
  sourceObservedAt: string;
  routeUpdatedAt: string;
  callAheadStatus: "called" | "not_called" | "";
};

type DispatchSnapshot = {
  date: string;
  mode: "live_control" | "preview_simulation";
  source: string;
  sourceObservedAt: string;
  appointments: DispatchAppointment[];
  trucks: string[];
  warning?: string;
};

type FleetControlIssue = {
  issueId: string;
  title: string;
  severity: "monitor" | "repair_soon" | "out_of_service";
  status: "open" | "in_progress" | "resolved";
  owner: string;
  dueDate: string;
  updatedAt: string;
};

type FleetControlTruck = {
  truck: string;
  readiness: "out_of_service" | "action_required" | "no_active_hold";
  activeIssueCount: number;
  blockingIssues: FleetControlIssue[];
  topAction: {
    kind: "repair" | "checklist" | "telemetry" | "mapping";
    priority: "stop" | "urgent" | "next" | "watch";
    title: string;
    detail: string;
  } | null;
  gpsFreshness: string;
  lastGpsUpdate: string;
  hasVerifiedCoordinate: boolean;
  truckLoad: {
    startingLoadFraction: number;
    currentLoadFraction: number;
    currentLoadLabel: string;
    currentContents: string;
    capacityPercent: number;
    isOverCapacity: boolean;
    lastEventId: string;
    lastEventLabel: string;
    lastEventRecordedAt: string;
  };
};

type FleetSnapshot = {
  date: string;
  mode: "live_control" | "preview_simulation";
  source: string;
  sourceObservedAt: string;
  storeUpdatedAt: string;
  truckLoadStoreUpdatedAt: string;
  trucks: FleetControlTruck[];
  summary: {
    trucks: number;
    outOfService: number;
    actionRequired: number;
    activeRepairs: number;
    incompleteInspections: number;
  };
  warning?: string;
};

type LinxupControlDisposition = "monitor" | "provider_follow_up" | "mapping_follow_up" | "no_issue_confirmed";

type LinxupControlDevice = {
  truck: string;
  freshness: string;
  lastGpsUpdate: string;
  deliveryMode: string;
  fallbackActive: boolean;
  latestV3PositionAt: string;
  mappingStatus: string;
  hasVerifiedCoordinate: boolean;
  attentionReason: string;
  observationKey: string;
  reviewCurrent: boolean;
  review: {
    recordId: string;
    disposition: LinxupControlDisposition;
    note: string;
    sourceObservationKey: string;
    updatedAt: string;
    updatedBy: string;
  } | null;
};

type LinxupSnapshot = {
  date: string;
  mode: "live_control" | "preview_simulation";
  source: string;
  sourceObservedAt: string;
  storeUpdatedAt: string;
  gpsDataStatus: string;
  devices: LinxupControlDevice[];
  mappingWarnings: string[];
  summary: {
    devices: number;
    live: number;
    stale: number;
    offline: number;
    missingCoordinate: number;
    fallback: number;
    reviewNeeded: number;
    reviewed: number;
  };
  warning?: string;
  authorityNotice: string;
};

type KrewePerson = {
  name: string;
  normalizedName: string;
  todayStatus: "worked_or_attributed" | "roster_only";
  clockIn: string;
  clockOut: string;
  truck: string;
  recommendedForCallIn: boolean;
  suggestedRole: "Driver" | "Crew" | "";
  recommendationReason: string;
  overtimeRisk: boolean;
  availability: {
    status: "available" | "unavailable" | "called_in";
    role: "driver" | "crew" | "";
    note: string;
    updatedAt: string;
  } | null;
};

type KreweSnapshot = {
  date: string;
  targetDate: string;
  mode: "live_control" | "preview_simulation";
  source: string;
  sourceObservedAt: string;
  storeUpdatedAt: string;
  scheduleUpdatedAt: string;
  scheduleAvailable: boolean;
  people: KrewePerson[];
  summary: {
    roster: number;
    workedToday: number;
    clockedInNow: number;
    tomorrowAppointments: number;
    requiredHeadcount: number;
    alreadyAssigned: number;
    callInNeeded: number;
    availableResponses: number;
    unavailableResponses: number;
    committedCallIns: number;
  };
  warning?: string;
  authorityNotice: string;
};

type CommunicationsSnapshot = {
  date: string;
  mode: "live_control" | "preview_simulation";
  source: string;
  sourceObservedAt: string;
  slack: {
    enabled: boolean;
    credentialAvailable: boolean;
    commandChannelConfigured: boolean;
    stateUpdatedAt: string;
    activeIncidents: number;
    deliveredToday: number;
  };
  whatsapp: {
    photos: { incoming: number; processing: number; completed: number; review: number; failed: number };
    photoConfirmations: { pending: number; delivered: number };
    slackPhotoBatches: { pending: number; delivered: number };
    expenses: { pending: number; processing: number; completed: number; failed: number; review: number };
    replies: { pending: number; processing: number; sent: number; failed: number };
  };
  podium: {
    connected: boolean;
    scopes: readonly string[];
    snapshotFetchedAt: string;
    locations: number;
    recentNeedsResponse: number;
    recentLowRatings: number;
    pendingAttribution: number;
    newToday: number;
  };
  warning?: string;
  authorityNotice: string;
};

type CustomerContactChannel = "phone" | "sms";
type CustomerContactOutcome = "reached" | "voicemail" | "no_answer" | "sms_sent" | "sms_not_sent";

type CustomerContactRecord = {
  recordId: string;
  channel: CustomerContactChannel;
  purpose: string;
  message: string;
  owner: string;
  nextAction: string;
  status: "approved" | "outcome_recorded" | "not_completed";
  outcome: CustomerContactOutcome | "";
  evidenceNote: string;
  junkwareVerifiedAt: string;
  updatedAt: string;
  updatedBy: string;
};

type CustomerContactAppointment = {
  appointmentId: string;
  jobKey: string;
  jkNumber: string;
  customerName: string;
  phone: string;
  maskedPhone: string;
  appointmentTime: string;
  status: string;
  territory: string;
  sourceObservedAt: string;
  observationKey: string;
  latestPlan: CustomerContactRecord | null;
  planCurrent: boolean;
};

type CustomerContactSnapshot = {
  date: string;
  mode: "live_control" | "preview_simulation";
  source: string;
  sourceObservedAt: string;
  storeUpdatedAt: string;
  appointments: CustomerContactAppointment[];
  summary: { contactable: number; approved: number; outcomesRecorded: number; notCompleted: number };
  authorityNotice: string;
  warning?: string;
};

type MarketingCandidate = {
  reference: string;
  appointmentId: string;
  jkNumber: string;
  appointmentDate: string;
  customerName: string;
  territory: string;
  truck: string;
  crew: string[];
  candidateKey: string;
  matchKind?: "exact_name" | "exact_first_last" | "name_initial";
};

type MarketingSnapshot = {
  date: string;
  mode: "live_control" | "preview_simulation";
  source: string;
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
    reviews: Array<{
      reviewUid: string;
      authorName: string;
      body: string;
      rating: number;
      createdAt: string;
      updatedAt: string;
      locationName: string;
      needsResponse: boolean;
      suggestions: MarketingCandidate[];
    }>;
    assignmentOptions: MarketingCandidate[];
  };
  authorityNotice: string;
};

type SearchKingsRecoveryStatus = "needs_follow_up" | "lost" | "unqualified";
type SearchKingsRecoveryReason = "" | "availability" | "pricing" | "missed_call" | "no_follow_up" | "competitor" | "out_of_area" | "service_not_offered" | "customer_declined" | "other";

type SearchKingsRecoveryLead = {
  callId: string;
  callerName: string;
  calledAt: string;
  territory: string;
  city: string;
  source: string;
  score: number | null;
  summary: string;
  tags: string[];
  status: SearchKingsRecoveryStatus;
  reason: SearchKingsRecoveryReason;
  owner: string;
  nextAction: string;
  evidenceNote: string;
  franchiseContacted: boolean;
  potentialRevenue: number | null;
  matchedAppointment: {
    appointmentId: string;
    jkNumber: string;
    date: string;
    status: string;
    completed: boolean;
    realizedRevenue: number | null;
  } | null;
  observationKey: string;
  overrideUpdatedAt: string;
};

type SearchKingsControlSnapshot = {
  date: string;
  mode: "live_control" | "preview_simulation";
  source: string;
  sourceObservedAt: string;
  rangeLabel: string;
  storeUpdatedAt: string;
  summary: {
    totalCalls: number;
    qualifiedCalls: number;
    lost: number;
    needsFollowUp: number;
    bookedOrRecovered: number;
    completedAttributedRevenue: number;
  };
  recoveryLeads: SearchKingsRecoveryLead[];
  authorityNotice: string;
  warning?: string;
};

type SystemsReviewDisposition = "monitor" | "owner_follow_up" | "credential_follow_up" | "source_recovery" | "no_issue_confirmed";

type SystemsIntegration = {
  integrationId: string;
  label: string;
  authority: string;
  status: "healthy" | "degraded" | "attention" | "unavailable";
  observedAt: string;
  freshness: string;
  detail: string;
  suggestedDisposition: SystemsReviewDisposition;
  suggestedNextAction: string;
  observationKey: string;
  reviewCurrent: boolean;
  review: {
    recordId: string;
    disposition: SystemsReviewDisposition;
    owner: string;
    nextAction: string;
    note: string;
    sourceObservationKey: string;
    updatedAt: string;
    updatedBy: string;
  } | null;
};

type SystemsSnapshot = {
  date: string;
  mode: "live_control" | "preview_simulation";
  source: string;
  sourceObservedAt: string;
  reviewStoreUpdatedAt: string;
  integrations: SystemsIntegration[];
  summary: {
    integrations: number;
    healthy: number;
    degraded: number;
    attention: number;
    unavailable: number;
    reviewed: number;
  };
  authorityNotice: string;
};

type FinanceSnapshot = {
  date: string;
  mode: "live_control" | "preview_simulation";
  source: string;
  sourceObservedAt: string;
  employees: Array<{ name: string; normalizedName: string; correctionUpdatedAt: string }>;
  paymentReconciliation: {
    status: "balanced" | "needs_review" | "merchant_data_missing" | "merchant_data_stale" | "not_collected";
    summary: {
      junkware_count: number;
      junkware_total: number;
      merchant_center_count: number;
      merchant_center_total: number;
      exception_count: number;
      net_difference: number;
    };
    exceptionCount: number;
    exceptions: Array<{
      exceptionId: string;
      date: string;
      type: string;
      reference: string;
      junkwareAmount: number | null;
      qboAmount: number | null;
      observationKey: string;
      suggestedDisposition: PaymentReviewDisposition;
      reviewCurrent: boolean;
      review: {
        recordId: string;
        disposition: PaymentReviewDisposition;
        owner: string;
        nextAction: string;
        note: string;
        sourceObservationKey: string;
        updatedAt: string;
        updatedBy: string;
      } | null;
    }>;
    reviewStoreUpdatedAt: string;
    currentReviewCount: number;
    generatedAt: string;
    merchantCenterAvailable: boolean;
    merchantCenterFresh: boolean;
    merchantCenterCollectedAt: string;
    merchantSourceName: string;
  };
  manualBonuses: { count: number; totalAmount: number; storeUpdatedAt: string };
  payrollCorrections: { count: number; storeUpdatedAt: string };
  authorityNotice: string;
};

type PaymentReviewDisposition = "keep_open" | "qbo_follow_up" | "junkware_follow_up" | "refund_verification" | "no_issue_confirmed";

async function responseJson<T>(response: Response): Promise<T> {
  const payload = await response.json().catch(() => ({})) as T & { error?: string };
  if (!response.ok) throw new Error(payload.error || `Request failed (${response.status})`);
  return payload;
}

function statusLabel(status: ActionRun["status"]): string {
  const labels: Record<ActionRun["status"], string> = {
    requested: "Submitted",
    awaiting_approval: "Waiting for approval",
    denied: "Denied",
    queued: "Starting",
    running: "In progress",
    verifying: "Checking result",
    succeeded: "Done",
    failed: "Failed",
    cancelled: "Cancelled",
  };
  return labels[status];
}

function changeModeLabel(mode: unknown): string {
  return mode === "live_control" ? "Live changes" : "Preview only";
}

function trackerConnectionLabel(mode: string): string {
  if (mode.includes("fallback")) return "backup updates";
  if (mode.includes("push")) return "direct updates";
  if (mode === "unavailable") return "not connected";
  return mode.replaceAll("_", " ");
}

function trackerMatchLabel(status: string): string {
  return status.toLowerCase() === "mapped" ? "matched to truck" : "not matched to truck";
}

function systemStatusLabel(status: string): string {
  if (status === "healthy") return "Working";
  if (status === "degraded") return "Has problems";
  if (status === "attention") return "Needs review";
  if (status === "unavailable") return "No connection";
  return status.replaceAll("_", " ");
}

function actionLabel(actionKey: string): string {
  const labels: Record<string, string> = {
    "work.acknowledge.v1": "Acknowledge",
    "work.assign_self.v1": "Assign to me",
    "work.snooze.v1": "Snooze",
    "work.reopen.v1": "Reopen",
    "work.resolve_manually.v1": "Close follow-up item",
    "jobs.update_closeout.v1": "Fix JunkWare closeout",
    "dispatch.assign_truck.v1": "Change appointment truck",
    "dispatch.call_ahead.v1": "Save call-ahead status",
    "dispatch.reschedule_time.v1": "Change appointment time",
    "dispatch.cancel_appointment.v1": "Cancel appointment",
    "dispatch.move_date.v1": "Move appointment to another date",
    "fleet.mark_out_of_service.v1": "Take truck out of service",
    "fleet.return_to_service.v1": "Return truck to service",
    "fleet.set_starting_load.v1": "Save starting truck load",
    "fleet.record_yard_reset.v1": "Save truck load reset",
    "finance.record_manual_bonus.v1": "Add manual bonus",
    "finance.record_payroll_correction.v1": "Correct payroll",
    "finance.record_payment_exception_review.v1": "Save payment follow-up",
    "krewe.record_availability.v1": "Save Krewe availability",
    "krewe.schedule_call_in.v1": "Schedule Krewe call-in",
    "communications.post_ops_command_notice.v1": "Post Slack update",
    "communications.approve_customer_contact.v1": "Prepare customer follow-up",
    "communications.record_customer_contact_outcome.v1": "Save customer contact result",
    "marketing.assign_podium_review.v1": "Match review to completed job",
    "systems.record_integration_review.v1": "Save system follow-up",
    "linxup.record_device_review.v1": "Save GPS tracker follow-up",
  };
  return labels[actionKey] || actionKey;
}

function activitySummary(run: ActionRun): string {
  if (run.status === "awaiting_approval") return "Waiting for another manager to review this request.";
  if (run.status === "succeeded") return "Completed and checked.";
  if (run.status === "denied") return "This request was denied.";
  if (run.status === "failed") return "This did not work. Refresh the information before trying again.";
  if (run.status === "cancelled") return "This request was cancelled.";
  return "OpsCenter is working on this request.";
}

function systemsFollowUpLabel(value: SystemsReviewDisposition): string {
  if (value === "owner_follow_up") return "Owner follow-up";
  if (value === "credential_follow_up") return "Fix login or connection";
  if (value === "source_recovery") return "Restore the data feed";
  if (value === "no_issue_confirmed") return "Nothing is wrong";
  return "Keep watching";
}

function linxupFollowUpLabel(value: LinxupControlDisposition): string {
  if (value === "provider_follow_up") return "Contact LinxUp";
  if (value === "mapping_follow_up") return "Check which tracker is in the truck";
  if (value === "no_issue_confirmed") return "Nothing is wrong";
  return "Keep watching";
}

function paymentFollowUpLabel(value: PaymentReviewDisposition): string {
  if (value === "qbo_follow_up") return "Check QBO";
  if (value === "junkware_follow_up") return "Check JunkWare";
  if (value === "refund_verification") return "Check a refund";
  if (value === "no_issue_confirmed") return "Difference is expected";
  return "Leave it open";
}

function activeItem(item: InboxWorkItem): boolean {
  return !["resolved", "dismissed"].includes(item.status);
}

function supportsCloseoutCorrection(item: InboxWorkItem): boolean {
  return item.entity.type === "job" && [
    "completed_job_with_no_driver",
    "completed_job_with_no_navigator",
    "job_with_revenue_but_no_credited_crew",
    "payment_amount_present_but_payment_type_missing",
  ].includes(item.rule);
}

function clockLabel(minutes: number): string {
  const hour = Math.floor(minutes / 60);
  return `${hour % 12 || 12}:00 ${hour >= 12 ? "PM" : "AM"}`;
}

function fleetReadinessLabel(readiness: FleetControlTruck["readiness"]): string {
  if (readiness === "out_of_service") return "Out of service";
  if (readiness === "action_required") return "Action required";
  return "No active hold";
}

function reconciliationLabel(status: FinanceSnapshot["paymentReconciliation"]["status"]): string {
  if (status === "balanced") return "Balanced";
  if (status === "needs_review") return "Needs review";
  if (status === "merchant_data_missing") return "QBO data missing";
  if (status === "merchant_data_stale") return "QBO data stale";
  return "Not collected";
}

function moneyLabel(value: number): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(value || 0);
}

function customerPhoneHref(value: string): string {
  const digits = String(value || "").replace(/\D/g, "");
  return digits.length >= 10 ? `tel:+1${digits.slice(-10)}` : "";
}

function customerSmsHref(phone: string, message: string): string {
  const href = customerPhoneHref(phone).replace(/^tel:/, "sms:");
  return href ? `${href}?&body=${encodeURIComponent(message)}` : "";
}

function paymentReviewNextAction(disposition: PaymentReviewDisposition): string {
  if (disposition === "qbo_follow_up") return "Check the transaction in QBO, then refresh this page.";
  if (disposition === "junkware_follow_up") return "Check the payment in JunkWare, then refresh this page.";
  if (disposition === "refund_verification") return "Check the correction or refund in QBO, then refresh this page.";
  if (disposition === "no_issue_confirmed") return "Write down why the difference is expected.";
  return "Leave it open until the numbers match or the cause is documented.";
}

const dispatchTimeOptions = Array.from({ length: 24 }, (_, hour) => hour * 60);
const truckStartingLoadOptions = [
  [0, "Empty"],
  [1 / 12, "Minimum / 1/12"],
  [1 / 8, "1/8 full"],
  [1 / 6, "1/6 full"],
  [1 / 4, "1/4 full"],
  [1 / 3, "1/3 full"],
  [3 / 8, "3/8 full"],
  [1 / 2, "1/2 full"],
  [5 / 8, "5/8 full"],
  [2 / 3, "2/3 full"],
  [3 / 4, "3/4 full"],
  [7 / 8, "7/8 full"],
  [1, "Full truck"],
] as const;

export default function OpsBotActionConsole({ date, enabled }: { date: string; enabled: boolean }) {
  const [inbox, setInbox] = useState<InboxPayload | null>(null);
  const [snapshot, setSnapshot] = useState<ActionSnapshot | null>(null);
  const [dispatch, setDispatch] = useState<DispatchSnapshot | null>(null);
  const [fleet, setFleet] = useState<FleetSnapshot | null>(null);
  const [linxup, setLinxup] = useState<LinxupSnapshot | null>(null);
  const [krewe, setKrewe] = useState<KreweSnapshot | null>(null);
  const [communications, setCommunications] = useState<CommunicationsSnapshot | null>(null);
  const [customerContact, setCustomerContact] = useState<CustomerContactSnapshot | null>(null);
  const [marketing, setMarketing] = useState<MarketingSnapshot | null>(null);
  const [searchKings, setSearchKings] = useState<SearchKingsControlSnapshot | null>(null);
  const [systems, setSystems] = useState<SystemsSnapshot | null>(null);
  const [finance, setFinance] = useState<FinanceSnapshot | null>(null);
  const [financeAccessDenied, setFinanceAccessDenied] = useState(false);
  const [selectedId, setSelectedId] = useState("");
  const [selectedAppointmentId, setSelectedAppointmentId] = useState("");
  const [selectedFleetTruckId, setSelectedFleetTruckId] = useState("");
  const [selectedLinxupTruckId, setSelectedLinxupTruckId] = useState("");
  const [selectedKreweEmployeeName, setSelectedKreweEmployeeName] = useState("");
  const [selectedCustomerContactAppointmentId, setSelectedCustomerContactAppointmentId] = useState("");
  const [selectedFinanceEmployeeName, setSelectedFinanceEmployeeName] = useState("");
  const [selectedFinanceExceptionId, setSelectedFinanceExceptionId] = useState("");
  const [selectedMarketingReviewUid, setSelectedMarketingReviewUid] = useState("");
  const [selectedSearchKingsCallId, setSelectedSearchKingsCallId] = useState("");
  const [selectedSystemsIntegrationId, setSelectedSystemsIntegrationId] = useState("");
  const [marketingAppointmentReference, setMarketingAppointmentReference] = useState("");
  const [searchKingsStatus, setSearchKingsStatus] = useState<SearchKingsRecoveryStatus>("needs_follow_up");
  const [searchKingsReason, setSearchKingsReason] = useState<SearchKingsRecoveryReason>("");
  const [searchKingsOwner, setSearchKingsOwner] = useState("");
  const [searchKingsNextAction, setSearchKingsNextAction] = useState("");
  const [searchKingsEvidenceNote, setSearchKingsEvidenceNote] = useState("");
  const [searchKingsFranchiseContacted, setSearchKingsFranchiseContacted] = useState(false);
  const [dispatchTruck, setDispatchTruck] = useState("");
  const [dispatchStartMinutes, setDispatchStartMinutes] = useState("");
  const [dispatchDestinationDate, setDispatchDestinationDate] = useState(date);
  const [cancellationReason, setCancellationReason] = useState("");
  const [fleetHoldReason, setFleetHoldReason] = useState("");
  const [fleetReturnResolution, setFleetReturnResolution] = useState("");
  const [fleetStartingLoad, setFleetStartingLoad] = useState("0");
  const [linxupDisposition, setLinxupDisposition] = useState<LinxupControlDisposition>("monitor");
  const [linxupReviewNote, setLinxupReviewNote] = useState("");
  const [kreweNote, setKreweNote] = useState("");
  const [kreweRole, setKreweRole] = useState<"driver" | "crew">("crew");
  const [slackNoticeSubject, setSlackNoticeSubject] = useState("");
  const [slackNoticeMessage, setSlackNoticeMessage] = useState("");
  const [slackNoticeOwner, setSlackNoticeOwner] = useState("");
  const [slackNoticeNextAction, setSlackNoticeNextAction] = useState("");
  const [customerContactChannel, setCustomerContactChannel] = useState<CustomerContactChannel>("phone");
  const [customerContactPurpose, setCustomerContactPurpose] = useState("");
  const [customerContactMessage, setCustomerContactMessage] = useState("");
  const [customerContactOwner, setCustomerContactOwner] = useState("");
  const [customerContactNextAction, setCustomerContactNextAction] = useState("");
  const [customerContactOutcome, setCustomerContactOutcome] = useState<CustomerContactOutcome>("reached");
  const [customerContactEvidence, setCustomerContactEvidence] = useState("");
  const [bonusAmount, setBonusAmount] = useState("");
  const [bonusNote, setBonusNote] = useState("");
  const [payrollClockIn, setPayrollClockIn] = useState("");
  const [payrollClockOut, setPayrollClockOut] = useState("");
  const [payrollHourlyRate, setPayrollHourlyRate] = useState("");
  const [payrollNote, setPayrollNote] = useState("");
  const [paymentReviewDisposition, setPaymentReviewDisposition] = useState<PaymentReviewDisposition>("keep_open");
  const [paymentReviewOwner, setPaymentReviewOwner] = useState("");
  const [paymentReviewNextStep, setPaymentReviewNextStep] = useState("");
  const [paymentReviewNote, setPaymentReviewNote] = useState("");
  const [systemsReviewDisposition, setSystemsReviewDisposition] = useState<SystemsReviewDisposition>("monitor");
  const [systemsReviewOwner, setSystemsReviewOwner] = useState("");
  const [systemsReviewNextAction, setSystemsReviewNextAction] = useState("");
  const [systemsReviewNote, setSystemsReviewNote] = useState("");
  const [resolutionReason, setResolutionReason] = useState("");
  const [loading, setLoading] = useState(enabled);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    if (!enabled) return;
    setLoading(true);
    setError("");
    try {
      const [inboxPayload, actionPayload, systemsPayload, dispatchPayload, fleetPayload, linxupPayload, krewePayload, communicationsPayload, customerContactPayload, marketingPayload, searchKingsPayload, financeResult] = await Promise.all([
        responseJson<InboxPayload>(await fetch("/api/inbox/reconcile", {
          method: "POST",
          cache: "no-store",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ date }),
        })),
        responseJson<ActionSnapshot>(await fetch("/api/platform/action-runs", { cache: "no-store" })),
        responseJson<SystemsSnapshot>(await fetch(`/api/platform/systems?date=${encodeURIComponent(date)}`, { cache: "no-store" })),
        responseJson<DispatchSnapshot>(await fetch(`/api/platform/dispatch?date=${encodeURIComponent(date)}`, { cache: "no-store" })),
        responseJson<FleetSnapshot>(await fetch(`/api/platform/fleet?date=${encodeURIComponent(date)}`, { cache: "no-store" })),
        responseJson<LinxupSnapshot>(await fetch(`/api/platform/linxup?date=${encodeURIComponent(date)}`, { cache: "no-store" })),
        responseJson<KreweSnapshot>(await fetch(`/api/platform/krewe?date=${encodeURIComponent(date)}`, { cache: "no-store" })),
        responseJson<CommunicationsSnapshot>(await fetch(`/api/platform/communications?date=${encodeURIComponent(date)}`, { cache: "no-store" })),
        responseJson<CustomerContactSnapshot>(await fetch(`/api/platform/customer-contact?date=${encodeURIComponent(date)}`, { cache: "no-store" })),
        responseJson<MarketingSnapshot>(await fetch(`/api/platform/marketing?date=${encodeURIComponent(date)}`, { cache: "no-store" })),
        responseJson<SearchKingsControlSnapshot>(await fetch(`/api/platform/searchkings?date=${encodeURIComponent(date)}`, { cache: "no-store" })),
        fetch(`/api/platform/finance?date=${encodeURIComponent(date)}`, { cache: "no-store" }).then(async (response) => {
          if (response.status === 403) return { payload: null, accessDenied: true };
          return { payload: await responseJson<FinanceSnapshot>(response), accessDenied: false };
        }),
      ]);
      setInbox(inboxPayload);
      setSnapshot(actionPayload);
      setSystems(systemsPayload);
      setDispatch(dispatchPayload);
      setFleet(fleetPayload);
      setLinxup(linxupPayload);
      setKrewe(krewePayload);
      setCommunications(communicationsPayload);
      setCustomerContact(customerContactPayload);
      setMarketing(marketingPayload);
      setSearchKings(searchKingsPayload);
      setFinance(financeResult.payload);
      setFinanceAccessDenied(financeResult.accessDenied);
      setSelectedId((current) => current && inboxPayload.items.some((item) => item.id === current)
        ? current
        : inboxPayload.items.find(activeItem)?.id || inboxPayload.items[0]?.id || "");
      setSelectedAppointmentId((current) => current && dispatchPayload.appointments.some((item) => item.appointmentId === current)
        ? current
        : dispatchPayload.appointments[0]?.appointmentId || "");
      setSelectedFleetTruckId((current) => current && fleetPayload.trucks.some((item) => item.truck === current)
        ? current
        : fleetPayload.trucks.find((item) => item.readiness === "out_of_service")?.truck || fleetPayload.trucks[0]?.truck || "");
      setSelectedLinxupTruckId((current) => current && linxupPayload.devices.some((item) => item.truck === current)
        ? current
        : linxupPayload.devices.find((item) => item.attentionReason !== "The truck location is current.")?.truck || linxupPayload.devices[0]?.truck || "");
      setSelectedKreweEmployeeName((current) => current && krewePayload.people.some((person) => person.name === current)
        ? current
        : krewePayload.people.find((person) => person.recommendedForCallIn)?.name || krewePayload.people[0]?.name || "");
      setSelectedCustomerContactAppointmentId((current) => current && customerContactPayload.appointments.some((appointment) => appointment.appointmentId === current)
        ? current
        : customerContactPayload.appointments.find((appointment) => appointment.latestPlan?.status === "approved" && appointment.planCurrent)?.appointmentId
          || customerContactPayload.appointments[0]?.appointmentId
          || "");
      setSelectedFinanceEmployeeName((current) => current && financeResult.payload?.employees.some((employee) => employee.name === current)
        ? current
        : financeResult.payload?.employees[0]?.name || "");
      setSelectedFinanceExceptionId((current) => current && financeResult.payload?.paymentReconciliation.exceptions.some((exception) => exception.exceptionId === current)
        ? current
        : financeResult.payload?.paymentReconciliation.exceptions.find((exception) => !exception.reviewCurrent)?.exceptionId
          || financeResult.payload?.paymentReconciliation.exceptions[0]?.exceptionId
          || "");
      setSelectedMarketingReviewUid((current) => current && marketingPayload.podium.reviews.some((review) => review.reviewUid === current)
        ? current
        : marketingPayload.podium.reviews.find((review) => review.suggestions.length > 0)?.reviewUid
          || marketingPayload.podium.reviews[0]?.reviewUid
          || "");
      setSelectedSearchKingsCallId((current) => current && searchKingsPayload.recoveryLeads.some((lead) => lead.callId === current)
        ? current
        : searchKingsPayload.recoveryLeads[0]?.callId || "");
      setSelectedSystemsIntegrationId((current) => current && systemsPayload.integrations.some((integration) => integration.integrationId === current)
        ? current
        : systemsPayload.integrations.find((integration) => integration.status !== "healthy" && !integration.reviewCurrent)?.integrationId
          || systemsPayload.integrations.find((integration) => integration.status !== "healthy")?.integrationId
          || systemsPayload.integrations[0]?.integrationId
          || "");
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "OpsBot could not load the latest information. Refresh and try again.");
    } finally {
      setLoading(false);
    }
  }, [date, enabled]);

  useEffect(() => {
    void load();
  }, [load]);

  const selected = useMemo(
    () => inbox?.items.find((item) => item.id === selectedId) || null,
    [inbox, selectedId],
  );
  const selectedAppointment = useMemo(
    () => dispatch?.appointments.find((appointment) => appointment.appointmentId === selectedAppointmentId) || null,
    [dispatch, selectedAppointmentId],
  );
  const selectedFleetTruck = useMemo(
    () => fleet?.trucks.find((truck) => truck.truck === selectedFleetTruckId) || null,
    [fleet, selectedFleetTruckId],
  );
  const selectedLinxupDevice = useMemo(
    () => linxup?.devices.find((device) => device.truck === selectedLinxupTruckId) || null,
    [linxup, selectedLinxupTruckId],
  );
  const selectedKrewePerson = useMemo(
    () => krewe?.people.find((person) => person.name === selectedKreweEmployeeName) || null,
    [krewe, selectedKreweEmployeeName],
  );
  const selectedCustomerContactAppointment = useMemo(
    () => customerContact?.appointments.find((appointment) => appointment.appointmentId === selectedCustomerContactAppointmentId) || null,
    [customerContact, selectedCustomerContactAppointmentId],
  );
  const selectedFinanceEmployee = useMemo(
    () => finance?.employees.find((employee) => employee.name === selectedFinanceEmployeeName) || null,
    [finance, selectedFinanceEmployeeName],
  );
  const selectedFinanceException = useMemo(
    () => finance?.paymentReconciliation.exceptions.find((exception) => exception.exceptionId === selectedFinanceExceptionId) || null,
    [finance, selectedFinanceExceptionId],
  );
  const selectedMarketingReview = useMemo(
    () => marketing?.podium.reviews.find((review) => review.reviewUid === selectedMarketingReviewUid) || null,
    [marketing, selectedMarketingReviewUid],
  );
  const selectedSearchKingsLead = useMemo(
    () => searchKings?.recoveryLeads.find((lead) => lead.callId === selectedSearchKingsCallId) || null,
    [searchKings, selectedSearchKingsCallId],
  );
  const selectedSystemsIntegration = useMemo(
    () => systems?.integrations.find((integration) => integration.integrationId === selectedSystemsIntegrationId) || null,
    [selectedSystemsIntegrationId, systems],
  );
  const selectedMarketingCandidate = useMemo(() => {
    const candidates = [...(selectedMarketingReview?.suggestions || []), ...(marketing?.podium.assignmentOptions || [])];
    const reference = marketingAppointmentReference.trim().toLowerCase();
    return candidates.find((candidate) => [candidate.reference, candidate.appointmentId, candidate.jkNumber]
      .some((value) => value.toLowerCase() === reference)) || null;
  }, [marketing, marketingAppointmentReference, selectedMarketingReview]);
  useEffect(() => {
    setDispatchTruck(selectedAppointment?.effectiveTruck || "");
    setDispatchStartMinutes(selectedAppointment?.appointmentStartMinutes == null ? "" : String(selectedAppointment.appointmentStartMinutes));
    setDispatchDestinationDate(date);
    setCancellationReason("");
  }, [date, selectedAppointment]);
  useEffect(() => {
    setFleetHoldReason("");
    setFleetReturnResolution("");
    setFleetStartingLoad(String(selectedFleetTruck?.truckLoad.startingLoadFraction || 0));
  }, [selectedFleetTruck]);
  useEffect(() => {
    setLinxupReviewNote("");
    setLinxupDisposition(selectedLinxupDevice?.mappingStatus !== "Mapped"
      ? "mapping_follow_up"
      : selectedLinxupDevice?.fallbackActive || selectedLinxupDevice?.deliveryMode === "unavailable"
        ? "provider_follow_up"
        : "monitor");
  }, [selectedLinxupDevice]);
  useEffect(() => {
    setKreweNote("");
    setKreweRole(selectedKrewePerson?.suggestedRole === "Driver" ? "driver" : "crew");
  }, [date, selectedKrewePerson]);
  useEffect(() => {
    const plan = selectedCustomerContactAppointment?.latestPlan;
    setCustomerContactChannel(plan?.channel || "phone");
    setCustomerContactPurpose(plan?.purpose || "Confirm appointment details and arrival expectations.");
    setCustomerContactMessage(plan?.message || "Hi, this is Junk King. We are reaching out about your scheduled appointment. Please reply or call us if anything has changed.");
    setCustomerContactOwner(plan?.owner || "");
    setCustomerContactNextAction(plan?.nextAction || "Record the human-confirmed outcome in JunkWare.");
    setCustomerContactOutcome(plan?.channel === "sms" ? "sms_sent" : "reached");
    setCustomerContactEvidence("");
  }, [selectedCustomerContactAppointment]);
  useEffect(() => {
    setBonusAmount("");
    setBonusNote("");
    setPayrollClockIn("");
    setPayrollClockOut("");
    setPayrollHourlyRate("");
    setPayrollNote("");
  }, [date, selectedFinanceEmployeeName]);
  useEffect(() => {
    const disposition = selectedFinanceException?.reviewCurrent && selectedFinanceException.review
      ? selectedFinanceException.review.disposition
      : selectedFinanceException?.suggestedDisposition || "keep_open";
    setPaymentReviewDisposition(disposition);
    setPaymentReviewOwner(selectedFinanceException?.reviewCurrent ? selectedFinanceException.review?.owner || "" : "");
    setPaymentReviewNextStep(selectedFinanceException?.reviewCurrent
      ? selectedFinanceException.review?.nextAction || paymentReviewNextAction(disposition)
      : paymentReviewNextAction(disposition));
    setPaymentReviewNote("");
  }, [date, selectedFinanceException]);
  useEffect(() => {
    setMarketingAppointmentReference(selectedMarketingReview?.suggestions[0]?.reference || "");
  }, [selectedMarketingReview]);
  useEffect(() => {
    setSearchKingsStatus(selectedSearchKingsLead?.status || "needs_follow_up");
    setSearchKingsReason(selectedSearchKingsLead?.reason || "");
    setSearchKingsOwner(selectedSearchKingsLead?.owner || "");
    setSearchKingsNextAction(selectedSearchKingsLead?.nextAction || "");
    setSearchKingsEvidenceNote("");
    setSearchKingsFranchiseContacted(selectedSearchKingsLead?.franchiseContacted === true);
  }, [selectedSearchKingsLead]);
  useEffect(() => {
    const disposition = selectedSystemsIntegration?.reviewCurrent && selectedSystemsIntegration.review
      ? selectedSystemsIntegration.review.disposition
      : selectedSystemsIntegration?.suggestedDisposition || "monitor";
    setSystemsReviewDisposition(disposition);
    setSystemsReviewOwner(selectedSystemsIntegration?.reviewCurrent ? selectedSystemsIntegration.review?.owner || "" : "");
    setSystemsReviewNextAction(selectedSystemsIntegration?.reviewCurrent
      ? selectedSystemsIntegration.review?.nextAction || selectedSystemsIntegration.suggestedNextAction
      : selectedSystemsIntegration?.suggestedNextAction || "");
    setSystemsReviewNote("");
  }, [selectedSystemsIntegration]);
  const recentRuns = snapshot?.runs.slice(0, 8) || [];

  async function requestWorkAction(actionKey: string, extra: Record<string, unknown> = {}) {
    if (!selected) return;
    setBusy(actionKey);
    setError("");
    try {
      await responseJson(await fetch("/api/platform/action-runs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          actionKey,
          entity: { type: "platform", id: selected.id, label: selected.title },
          workItemId: selected.id,
          input: { expectedVersion: selected.version, ...extra },
        }),
      }));
      setResolutionReason("");
      await load();
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "OpsCenter could not complete that step. Refresh and try again.");
    } finally {
      setBusy("");
    }
  }

  async function requestSystemsIntegrationReview() {
    if (!selectedSystemsIntegration || !systems) return;
    const actionKey = "systems.record_integration_review.v1";
    setBusy(actionKey);
    setError("");
    try {
      await responseJson(await fetch("/api/platform/action-runs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          actionKey,
          entity: {
            type: "platform",
            id: `integration:${selectedSystemsIntegration.integrationId}`,
            label: selectedSystemsIntegration.label,
          },
          input: {
            date,
            integrationId: selectedSystemsIntegration.integrationId,
            disposition: systemsReviewDisposition,
            owner: systemsReviewOwner,
            nextAction: systemsReviewNextAction,
            note: systemsReviewNote,
            expectedReviewStoreUpdatedAt: systems.reviewStoreUpdatedAt,
            expectedReviewUpdatedAt: selectedSystemsIntegration.review?.updatedAt || "",
            expectedObservationKey: selectedSystemsIntegration.observationKey,
          },
        }),
      }));
      setSystemsReviewNote("");
      await load();
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "OpsCenter could not save the system follow-up. Refresh and try again.");
    } finally {
      setBusy("");
    }
  }

  async function requestDispatchAction(actionKey: string, input: Record<string, unknown>) {
    if (!selectedAppointment) return;
    setBusy(actionKey);
    setError("");
    try {
      await responseJson(await fetch("/api/platform/action-runs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          actionKey,
          entity: { type: "job", id: selectedAppointment.appointmentId, label: selectedAppointment.jkNumber },
          input: {
            date,
            appointmentId: selectedAppointment.appointmentId,
            jobKey: selectedAppointment.jobKey,
            sourceObservedAt: selectedAppointment.sourceObservedAt,
            ...input,
          },
        }),
      }));
      if (actionKey === "dispatch.cancel_appointment.v1") setCancellationReason("");
      await load();
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "OpsCenter could not save the appointment change. Refresh and try again.");
    } finally {
      setBusy("");
    }
  }

  async function requestFleetAction(actionKey: string, input: Record<string, unknown>) {
    if (!selectedFleetTruck || !fleet) return;
    setBusy(actionKey);
    setError("");
    try {
      await responseJson(await fetch("/api/platform/action-runs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          actionKey,
          entity: { type: "truck", id: selectedFleetTruck.truck, label: selectedFleetTruck.truck },
          input: {
            truck: selectedFleetTruck.truck,
            expectedStoreUpdatedAt: fleet.storeUpdatedAt,
            ...input,
          },
        }),
      }));
      setFleetHoldReason("");
      setFleetReturnResolution("");
      await load();
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "OpsCenter could not save the truck change. Refresh and try again.");
    } finally {
      setBusy("");
    }
  }

  async function requestLinxupReview() {
    if (!selectedLinxupDevice || !linxup) return;
    const actionKey = "linxup.record_device_review.v1";
    setBusy(actionKey);
    setError("");
    try {
      await responseJson(await fetch("/api/platform/action-runs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          actionKey,
          entity: { type: "truck", id: selectedLinxupDevice.truck, label: selectedLinxupDevice.truck },
          input: {
            date,
            truck: selectedLinxupDevice.truck,
            disposition: linxupDisposition,
            note: linxupReviewNote,
            expectedStoreUpdatedAt: linxup.storeUpdatedAt,
            expectedRecordUpdatedAt: selectedLinxupDevice.review?.updatedAt || "",
            expectedObservationKey: selectedLinxupDevice.observationKey,
          },
        }),
      }));
      setLinxupReviewNote("");
      await load();
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "OpsCenter could not save the GPS follow-up. Refresh and try again.");
    } finally {
      setBusy("");
    }
  }

  async function requestKreweAction(actionKey: string, input: Record<string, unknown>) {
    if (!selectedKrewePerson || !krewe) return;
    setBusy(actionKey);
    setError("");
    try {
      await responseJson(await fetch("/api/platform/action-runs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          actionKey,
          entity: { type: "employee", id: selectedKrewePerson.name, label: selectedKrewePerson.name },
          input: {
            employeeName: selectedKrewePerson.name,
            targetDate: krewe.targetDate,
            expectedStoreUpdatedAt: krewe.storeUpdatedAt,
            expectedRecordUpdatedAt: selectedKrewePerson.availability?.updatedAt || "",
            ...input,
          },
        }),
      }));
      setKreweNote("");
      await load();
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "OpsCenter could not save the Krewe update. Refresh and try again.");
    } finally {
      setBusy("");
    }
  }

  async function requestFinanceAction(actionKey: string, input: Record<string, unknown>) {
    if (!selectedFinanceEmployee || !finance) return;
    setBusy(actionKey);
    setError("");
    try {
      await responseJson(await fetch("/api/platform/action-runs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          actionKey,
          entity: { type: "employee", id: selectedFinanceEmployee.name, label: selectedFinanceEmployee.name },
          input: { employeeName: selectedFinanceEmployee.name, workDate: date, ...input },
        }),
      }));
      setBonusAmount("");
      setBonusNote("");
      setPayrollClockIn("");
      setPayrollClockOut("");
      setPayrollHourlyRate("");
      setPayrollNote("");
      await load();
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "OpsCenter could not save the money or payroll change. Refresh and try again.");
    } finally {
      setBusy("");
    }
  }

  async function requestPaymentExceptionReview() {
    if (!selectedFinanceException || !finance) return;
    const actionKey = "finance.record_payment_exception_review.v1";
    setBusy(actionKey);
    setError("");
    try {
      await responseJson(await fetch("/api/platform/action-runs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          actionKey,
          entity: {
            type: "finance",
            id: selectedFinanceException.exceptionId,
            label: `${selectedFinanceException.type} · ${selectedFinanceException.reference}`,
          },
          input: {
            date,
            exceptionId: selectedFinanceException.exceptionId,
            disposition: paymentReviewDisposition,
            owner: paymentReviewOwner,
            nextAction: paymentReviewNextStep,
            note: paymentReviewNote,
            expectedReviewStoreUpdatedAt: finance.paymentReconciliation.reviewStoreUpdatedAt,
            expectedReviewUpdatedAt: selectedFinanceException.review?.updatedAt || "",
            expectedObservationKey: selectedFinanceException.observationKey,
          },
        }),
      }));
      setPaymentReviewNote("");
      await load();
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "OpsCenter could not save the payment follow-up. Refresh and try again.");
    } finally {
      setBusy("");
    }
  }

  async function requestCommunicationsAction() {
    if (!communications) return;
    const actionKey = "communications.post_ops_command_notice.v1";
    setBusy(actionKey);
    setError("");
    try {
      await responseJson(await fetch("/api/platform/action-runs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          actionKey,
          entity: { type: "platform", id: "communications:ops-command", label: "Ops Command" },
          input: {
            subject: slackNoticeSubject,
            message: slackNoticeMessage,
            owner: slackNoticeOwner,
            nextAction: slackNoticeNextAction,
          },
        }),
      }));
      setSlackNoticeSubject("");
      setSlackNoticeMessage("");
      setSlackNoticeOwner("");
      setSlackNoticeNextAction("");
      await load();
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "OpsCenter could not save the team message. Refresh and try again.");
    } finally {
      setBusy("");
    }
  }

  async function requestCustomerContactPlan() {
    if (!customerContact || !selectedCustomerContactAppointment) return;
    const actionKey = "communications.approve_customer_contact.v1";
    setBusy(actionKey);
    setError("");
    try {
      await responseJson(await fetch("/api/platform/action-runs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          actionKey,
          entity: { type: "customer", id: `appointment:${selectedCustomerContactAppointment.appointmentId}`, label: selectedCustomerContactAppointment.jkNumber },
          input: {
            date,
            appointmentId: selectedCustomerContactAppointment.appointmentId,
            jobKey: selectedCustomerContactAppointment.jobKey,
            channel: customerContactChannel,
            purpose: customerContactPurpose,
            message: customerContactChannel === "sms" ? customerContactMessage : "",
            owner: customerContactOwner,
            nextAction: customerContactNextAction,
            sourceObservedAt: selectedCustomerContactAppointment.sourceObservedAt,
            expectedObservationKey: selectedCustomerContactAppointment.observationKey,
            expectedStoreUpdatedAt: customerContact.storeUpdatedAt,
          },
        }),
      }));
      await load();
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "OpsCenter could not save the customer follow-up plan. Refresh and try again.");
    } finally {
      setBusy("");
    }
  }

  async function recordCustomerContactOutcome() {
    const plan = selectedCustomerContactAppointment?.latestPlan;
    if (!customerContact || !selectedCustomerContactAppointment || !plan) return;
    const actionKey = "communications.record_customer_contact_outcome.v1";
    setBusy(actionKey);
    setError("");
    try {
      await responseJson(await fetch("/api/platform/action-runs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          actionKey,
          entity: { type: "customer", id: `appointment:${selectedCustomerContactAppointment.appointmentId}`, label: selectedCustomerContactAppointment.jkNumber },
          input: {
            date,
            appointmentId: selectedCustomerContactAppointment.appointmentId,
            jobKey: selectedCustomerContactAppointment.jobKey,
            recordId: plan.recordId,
            outcome: customerContactOutcome,
            evidenceNote: customerContactEvidence,
            sourceObservedAt: selectedCustomerContactAppointment.sourceObservedAt,
            expectedObservationKey: selectedCustomerContactAppointment.observationKey,
            expectedStoreUpdatedAt: customerContact.storeUpdatedAt,
            expectedRecordUpdatedAt: plan.updatedAt,
          },
        }),
      }));
      setCustomerContactEvidence("");
      await load();
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "OpsCenter could not save what happened. Refresh and try again.");
    } finally {
      setBusy("");
    }
  }

  async function requestMarketingAttribution(assignmentMode: "confirm_suggestion" | "reassign") {
    if (!marketing || !selectedMarketingReview || !selectedMarketingCandidate) return;
    const actionKey = "marketing.assign_podium_review.v1";
    setBusy(actionKey);
    setError("");
    try {
      await responseJson(await fetch("/api/platform/action-runs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          actionKey,
          entity: {
            type: "review",
            id: selectedMarketingReview.reviewUid,
            label: `${selectedMarketingReview.authorName} · ${selectedMarketingCandidate.jkNumber}`,
          },
          input: {
            reviewUid: selectedMarketingReview.reviewUid,
            appointmentReference: selectedMarketingCandidate.reference,
            assignmentMode,
            expectedSnapshotFetchedAt: marketing.podium.snapshotFetchedAt,
            expectedReviewUpdatedAt: selectedMarketingReview.updatedAt,
            expectedAssignmentStoreUpdatedAt: marketing.podium.assignmentStoreUpdatedAt,
            expectedAssignmentUpdatedAt: "",
            expectedCandidateKey: selectedMarketingCandidate.candidateKey,
            expectedCandidateAppointmentId: selectedMarketingCandidate.appointmentId,
            expectedCandidateJkNumber: selectedMarketingCandidate.jkNumber,
            expectedCandidateCrew: selectedMarketingCandidate.crew,
          },
        }),
      }));
      await load();
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "OpsCenter could not save the review match. Refresh and try again.");
    } finally {
      setBusy("");
    }
  }

  async function requestSearchKingsRecovery() {
    if (!searchKings || !selectedSearchKingsLead) return;
    const actionKey = "marketing.record_searchkings_recovery.v1";
    setBusy(actionKey);
    setError("");
    try {
      await responseJson(await fetch("/api/platform/action-runs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          actionKey,
          entity: { type: "lead", id: selectedSearchKingsLead.callId, label: "SearchKings recovery lead" },
          input: {
            date,
            callId: selectedSearchKingsLead.callId,
            status: searchKingsStatus,
            reason: searchKingsReason,
            owner: searchKingsOwner,
            nextAction: searchKingsNextAction,
            evidenceNote: searchKingsEvidenceNote,
            franchiseContacted: searchKingsFranchiseContacted,
            expectedSnapshotFetchedAt: searchKings.sourceObservedAt,
            expectedStoreUpdatedAt: searchKings.storeUpdatedAt,
            expectedOverrideUpdatedAt: selectedSearchKingsLead.overrideUpdatedAt,
            expectedObservationKey: selectedSearchKingsLead.observationKey,
          },
        }),
      }));
      setSearchKingsEvidenceNote("");
      await load();
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "OpsCenter could not save the missed-lead follow-up. Refresh and try again.");
    } finally {
      setBusy("");
    }
  }

  async function approve(run: ActionRun, decision: "approved" | "denied") {
    setBusy(`${run.id}:${decision}`);
    setError("");
    try {
      await responseJson(await fetch(`/api/platform/action-runs/${encodeURIComponent(run.id)}/approve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ decision, reason: decision === "approved" ? "Approved in OpsBot Control." : "Denied in OpsBot Control." }),
      }));
      await load();
    } catch (approvalError) {
      setError(approvalError instanceof Error ? approvalError.message : "OpsCenter could not save your approval choice. Refresh and try again.");
    } finally {
      setBusy("");
    }
  }

  if (!enabled) {
    return (
      <section className={`${styles.console} ${styles.disabled}`} aria-labelledby="opsbot-command-title">
        <div>
          <span>Take action</span>
          <h3 id="opsbot-command-title">This dashboard is view-only right now</h3>
          <p>You can review current information and next steps, but these buttons cannot change shared OpsCenter data in this environment.</p>
        </div>
        <strong>View only</strong>
      </section>
    );
  }

  return (
    <section className={styles.console} aria-labelledby="opsbot-command-title">
      <div className={styles.head}>
        <div>
          <span>Take action</span>
          <h3 id="opsbot-command-title">Choose an area and complete the next step</h3>
          <p>Current information comes first. Important changes wait for another manager, and OpsCenter keeps a record of what happened.</p>
        </div>
        <button type="button" onClick={() => void load()} disabled={loading || Boolean(busy)}>
          {loading ? "Refreshing…" : "Refresh information"}
        </button>
      </div>

      {error ? <div className={styles.error} role="alert">{error}</div> : null}

      <div className={styles.workspace}>
        <div className={styles.commandPane}>
          <section className={styles.systemsControl} aria-labelledby="opsbot-systems-title">
            <div className={styles.controlTitle}>
              <div><span>Systems</span><strong id="opsbot-systems-title">What is working and what needs attention</strong></div>
              <small data-mode={systems?.mode}>{changeModeLabel(systems?.mode)}</small>
            </div>
            <div className={styles.systemsSummary}>
              <div data-status="healthy"><b>{systems?.summary.healthy || 0}</b><span>working</span></div>
              <div data-status="degraded"><b>{systems?.summary.degraded || 0}</b><span>problems</span></div>
              <div data-status="attention"><b>{systems?.summary.attention || 0}</b><span>need review</span></div>
              <div data-status="unavailable"><b>{systems?.summary.unavailable || 0}</b><span>no connection</span></div>
            </div>
            <div className={styles.systemsEvidence}>
              <span>{systems?.summary.integrations || 0} connected systems</span>
              <span>{systems?.summary.reviewed || 0} follow-up plans saved</span>
              <span>OpsBot cannot restart systems</span>
            </div>
            <label>
              <span>Choose a system</span>
              <select value={selectedSystemsIntegrationId} onChange={(event) => setSelectedSystemsIntegrationId(event.target.value)} disabled={loading || Boolean(busy)}>
                {(systems?.integrations || []).map((integration) => (
                  <option key={integration.integrationId} value={integration.integrationId}>
                    {systemStatusLabel(integration.status)} · {integration.label} · {integration.freshness}
                  </option>
                ))}
              </select>
            </label>
            {selectedSystemsIntegration ? (
              <article className={styles.systemsTarget} data-status={selectedSystemsIntegration.status}>
                <div><strong>{selectedSystemsIntegration.label}</strong><span>{systemStatusLabel(selectedSystemsIntegration.status)}</span></div>
                <p>{selectedSystemsIntegration.detail}</p>
                <small>Last update: {selectedSystemsIntegration.freshness}</small>
                {selectedSystemsIntegration.review ? (
                  <div className={styles.systemsReviewReceipt} data-current={selectedSystemsIntegration.reviewCurrent}>
                    <span>{selectedSystemsIntegration.reviewCurrent ? "Current follow-up plan" : "Older plan — system changed"}</span>
                    <p>{selectedSystemsIntegration.review.owner} · {selectedSystemsIntegration.review.nextAction}</p>
                    <small>{systemsFollowUpLabel(selectedSystemsIntegration.review.disposition)} · saved by {selectedSystemsIntegration.review.updatedBy}</small>
                  </div>
                ) : null}
              </article>
            ) : <div className={styles.empty}>No system information is available.</div>}
            {selectedSystemsIntegration ? (
              <div className={styles.systemsReviewForm}>
                <label>
                  <span>What should happen?</span>
                  <select value={systemsReviewDisposition} onChange={(event) => setSystemsReviewDisposition(event.target.value as SystemsReviewDisposition)} disabled={Boolean(busy)}>
                    <option value="monitor">Keep watching</option>
                    <option value="owner_follow_up">Have the owner follow up</option>
                    <option value="credential_follow_up">Fix login or connection</option>
                    <option value="source_recovery">Restore the data feed</option>
                    <option value="no_issue_confirmed">Nothing is wrong</option>
                  </select>
                </label>
                <label>
                  <span>Owner</span>
                  <input value={systemsReviewOwner} onChange={(event) => setSystemsReviewOwner(event.target.value)} placeholder="Who will handle this?" maxLength={120} disabled={Boolean(busy)} />
                </label>
                <label className={styles.systemsNextAction}>
                  <span>Next step</span>
                  <input value={systemsReviewNextAction} onChange={(event) => setSystemsReviewNextAction(event.target.value)} maxLength={240} disabled={Boolean(busy)} />
                </label>
                <label className={styles.systemsReviewEvidence}>
                  <span>What did you check?</span>
                  <textarea value={systemsReviewNote} onChange={(event) => setSystemsReviewNote(event.target.value)} placeholder="Describe what you checked. Do not paste passwords or customer information." maxLength={1000} disabled={Boolean(busy)} />
                </label>
                <button
                  type="button"
                  disabled={Boolean(busy) || systemsReviewOwner.trim().length < 2 || systemsReviewNextAction.trim().length < 5 || systemsReviewNote.trim().length < 5}
                  onClick={() => void requestSystemsIntegrationReview()}
                >Ask a manager to save this plan</button>
                <small>This saves the follow-up plan only. It does not restart anything or change a password.</small>
              </div>
            ) : null}
            <div className={styles.systemsBoundary}>
              <p>This section can save an owner and next step. It cannot restart systems or change passwords.</p>
            </div>
          </section>

          <section className={styles.dispatchControl} aria-labelledby="opsbot-dispatch-title">
            <div className={styles.controlTitle}>
              <div><span>Jobs &amp; schedule</span><strong id="opsbot-dispatch-title">Move a truck, record a call, or change an appointment</strong></div>
              <small data-mode={dispatch?.mode}>{changeModeLabel(dispatch?.mode)}</small>
            </div>
            {dispatch?.warning ? <div className={styles.dispatchWarning}>{dispatch.warning}</div> : null}
            <label>
              <span>Choose an appointment</span>
              <select value={selectedAppointmentId} onChange={(event) => setSelectedAppointmentId(event.target.value)} disabled={loading || Boolean(busy)}>
                {(dispatch?.appointments || []).map((appointment) => (
                  <option key={appointment.appointmentId} value={appointment.appointmentId}>
                    {appointment.appointmentTime} · {appointment.jkNumber}{appointment.customerName ? ` · ${appointment.customerName}` : ""}
                  </option>
                ))}
              </select>
            </label>
            {selectedAppointment ? (
              <article className={styles.dispatchTarget}>
                <div><strong>{selectedAppointment.jkNumber}</strong><span>{selectedAppointment.territory || "Territory unavailable"}</span></div>
                <p>{selectedAppointment.appointmentTime} · {selectedAppointment.appointmentType || "Appointment"} · {selectedAppointment.status || "Status unavailable"}</p>
                <small>Current truck: {selectedAppointment.effectiveTruck || "Needs assignment"} · Call ahead: {selectedAppointment.callAheadStatus ? selectedAppointment.callAheadStatus.replace("_", " ") : "Not recorded"}</small>
              </article>
            ) : <div className={styles.empty}>No active appointment is available for this date.</div>}
            {selectedAppointment ? (
              <div className={styles.dispatchActions}>
                <label>
                  <span>Requested truck</span>
                  <select value={dispatchTruck} onChange={(event) => setDispatchTruck(event.target.value)} disabled={Boolean(busy)}>
                    <option value="">Needs assignment</option>
                    {(dispatch?.trucks || []).map((truck) => <option key={truck} value={truck}>{truck}</option>)}
                  </select>
                </label>
                <button
                  type="button"
                  disabled={Boolean(busy) || dispatchTruck === selectedAppointment.effectiveTruck}
                  onClick={() => void requestDispatchAction("dispatch.assign_truck.v1", {
                    truck: dispatchTruck,
                    expectedSourceTruck: selectedAppointment.sourceTruck,
                    expectedRouteUpdatedAt: selectedAppointment.routeUpdatedAt,
                  })}
                >
                  Ask a manager to change the truck
                </button>
                <div className={styles.callAheadActions}>
                  <button
                    type="button"
                    disabled={Boolean(busy) || selectedAppointment.callAheadStatus === "called"}
                    onClick={() => void requestDispatchAction("dispatch.call_ahead.v1", { status: "called", expectedStatus: selectedAppointment.callAheadStatus })}
                  >Mark called</button>
                  <button
                    type="button"
                    disabled={Boolean(busy) || selectedAppointment.callAheadStatus === "not_called"}
                    onClick={() => void requestDispatchAction("dispatch.call_ahead.v1", { status: "not_called", expectedStatus: selectedAppointment.callAheadStatus })}
                  >Mark not called</button>
                </div>
                <div className={styles.rescheduleActions}>
                  <label>
                    <span>Requested time</span>
                    <select value={dispatchStartMinutes} onChange={(event) => setDispatchStartMinutes(event.target.value)} disabled={Boolean(busy)}>
                      {selectedAppointment.appointmentStartMinutes == null ? <option value="">Choose a time</option> : null}
                      {dispatchTimeOptions.map((minutes) => <option key={minutes} value={minutes}>{clockLabel(minutes)}</option>)}
                    </select>
                  </label>
                  <button
                    type="button"
                    disabled={Boolean(busy) || !dispatchStartMinutes || Number(dispatchStartMinutes) === selectedAppointment.appointmentStartMinutes}
                    onClick={() => void requestDispatchAction("dispatch.reschedule_time.v1", {
                      appointmentStartMinutes: Number(dispatchStartMinutes),
                      durationHours: selectedAppointment.appointmentStartMinutes != null && selectedAppointment.appointmentEndMinutes != null
                        ? Math.max(1, Math.round((selectedAppointment.appointmentEndMinutes - selectedAppointment.appointmentStartMinutes) / 60))
                        : 1,
                      expectedAppointmentTime: selectedAppointment.appointmentTime,
                      expectedEffectiveTruck: selectedAppointment.effectiveTruck,
                      expectedRouteUpdatedAt: selectedAppointment.routeUpdatedAt,
                    })}
                  >Ask a manager to change the time</button>
                </div>
                <div className={styles.dateMoveActions}>
                  <label>
                    <span>Destination date</span>
                    <input
                      type="date"
                      value={dispatchDestinationDate}
                      onChange={(event) => setDispatchDestinationDate(event.target.value)}
                      disabled={Boolean(busy)}
                    />
                  </label>
                  <button
                    type="button"
                    disabled={Boolean(busy) || !dispatchDestinationDate || dispatchDestinationDate === date || !dispatchStartMinutes || selectedAppointment.appointmentStartMinutes == null}
                    onClick={() => void requestDispatchAction("dispatch.move_date.v1", {
                      destinationDate: dispatchDestinationDate,
                      appointmentStartMinutes: Number(dispatchStartMinutes),
                      expectedAppointmentStartMinutes: selectedAppointment.appointmentStartMinutes,
                      expectedAppointmentTime: selectedAppointment.appointmentTime,
                      expectedStatus: selectedAppointment.status,
                      expectedRouteUpdatedAt: selectedAppointment.routeUpdatedAt,
                    })}
                  >Ask a manager to move the date</button>
                  <small>The new appointment will use the time selected above. OpsCenter checks both the date and time after saving.</small>
                </div>
                <div className={styles.cancellationActions}>
                  <label>
                    <span>Cancellation reason</span>
                    <input
                      value={cancellationReason}
                      onChange={(event) => setCancellationReason(event.target.value)}
                      placeholder="Record the customer or operating reason"
                      maxLength={500}
                      disabled={Boolean(busy)}
                    />
                  </label>
                  <button
                    type="button"
                    disabled={Boolean(busy) || cancellationReason.trim().length < 3}
                    onClick={() => void requestDispatchAction("dispatch.cancel_appointment.v1", {
                      cancellationReason,
                      expectedStatus: selectedAppointment.status,
                      expectedAppointmentTime: selectedAppointment.appointmentTime,
                      expectedRouteUpdatedAt: selectedAppointment.routeUpdatedAt,
                    })}
                  >Ask a manager to cancel this job</button>
                  <small>Cancellation does not happen until another manager approves it.</small>
                </div>
              </div>
            ) : null}
            <p className={styles.dispatchBoundary}>
              {dispatch?.mode === "live_control"
                ? "Truck, time, date, and cancellation changes wait for another manager. OpsCenter checks JunkWare after the change."
                : "Preview only: these buttons show the process without changing the schedule or JunkWare."}
            </p>
          </section>

          <section className={styles.kreweControl} aria-labelledby="opsbot-krewe-title">
            <div className={styles.controlTitle}>
              <div><span>Krewe</span><strong id="opsbot-krewe-title">Plan tomorrow’s staffing</strong></div>
              <small data-mode={krewe?.mode}>{changeModeLabel(krewe?.mode)}</small>
            </div>
            <div className={styles.kreweSummary}>
              <div><b>{krewe?.summary.workedToday || 0}</b><span>worked today</span></div>
              <div><b>{krewe?.summary.tomorrowAppointments || 0}</b><span>tomorrow’s jobs</span></div>
              <div><b>{krewe?.summary.alreadyAssigned || 0}</b><span>already assigned</span></div>
              <div data-attention={Boolean(krewe?.summary.callInNeeded)}><b>{krewe?.summary.callInNeeded || 0}</b><span>call-ins needed</span></div>
            </div>
            <div className={styles.kreweResponses}>
              <span>{krewe?.summary.availableResponses || 0} available</span>
              <span>{krewe?.summary.unavailableResponses || 0} unavailable</span>
              <span>{krewe?.summary.committedCallIns || 0} committed</span>
              <span>{krewe?.summary.requiredHeadcount || 0} people needed</span>
            </div>
            {krewe?.warning ? <div className={styles.dispatchWarning}>{krewe.warning}</div> : null}
            <label>
              <span>Choose a Krewe member · {krewe?.targetDate || "tomorrow"}</span>
              <select value={selectedKreweEmployeeName} onChange={(event) => setSelectedKreweEmployeeName(event.target.value)} disabled={loading || Boolean(busy)}>
                {(krewe?.people || []).map((person) => (
                  <option key={person.normalizedName} value={person.name}>
                    {person.recommendedForCallIn ? "Recommended · " : ""}{person.name}{person.availability ? ` · ${person.availability.status.replace("_", " ")}` : ""}
                  </option>
                ))}
              </select>
            </label>
            {selectedKrewePerson ? (
              <article className={styles.kreweTarget} data-status={selectedKrewePerson.availability?.status || "unconfirmed"}>
                <div>
                  <strong>{selectedKrewePerson.name}</strong>
                  <span>{selectedKrewePerson.availability?.status.replace("_", " ") || "Availability unconfirmed"}</span>
                </div>
                <p>{selectedKrewePerson.recommendedForCallIn
                  ? `Recommended ${selectedKrewePerson.suggestedRole === "Crew" ? "Krewe" : selectedKrewePerson.suggestedRole}`
                  : selectedKrewePerson.todayStatus === "worked_or_attributed" ? "Worked or attributed today" : "Roster only today"}</p>
                <small>{selectedKrewePerson.recommendationReason || `${selectedKrewePerson.truck || "No truck"} · ${selectedKrewePerson.clockIn || "No clock-in"}${selectedKrewePerson.clockOut ? ` – ${selectedKrewePerson.clockOut}` : ""}`}</small>
                {selectedKrewePerson.overtimeRisk ? <em>Overtime risk in the current planning estimate</em> : null}
                {selectedKrewePerson.availability?.note ? <small>Confirmation note: {selectedKrewePerson.availability.note}</small> : null}
              </article>
            ) : <div className={styles.empty}>No Krewe roster is available.</div>}
            {selectedKrewePerson ? (
              <div className={styles.kreweActions}>
                <label>
                  <span>Who confirmed this?</span>
                  <input value={kreweNote} onChange={(event) => setKreweNote(event.target.value)} placeholder="Record who confirmed and how" maxLength={1000} disabled={Boolean(busy)} />
                </label>
                <div className={styles.availabilityActions}>
                  <button
                    type="button"
                    disabled={Boolean(busy) || kreweNote.trim().length < 3 || selectedKrewePerson.availability?.status === "called_in"}
                    onClick={() => void requestKreweAction("krewe.record_availability.v1", { status: "available", note: kreweNote })}
                  >Mark available</button>
                  <button
                    type="button"
                    disabled={Boolean(busy) || kreweNote.trim().length < 3 || selectedKrewePerson.availability?.status === "called_in"}
                    onClick={() => void requestKreweAction("krewe.record_availability.v1", { status: "unavailable", note: kreweNote })}
                  >Mark unavailable</button>
                </div>
                <div className={styles.callInCommitment}>
                  <label>
                    <span>Call-in role</span>
                    <select value={kreweRole} onChange={(event) => setKreweRole(event.target.value as "driver" | "crew")} disabled={Boolean(busy)}>
                      <option value="crew">Krewe</option>
                      <option value="driver">Driver</option>
                    </select>
                  </label>
                  <button
                    type="button"
                    disabled={
                      Boolean(busy)
                      || kreweNote.trim().length < 5
                      || !krewe?.scheduleAvailable
                      || !krewe.scheduleUpdatedAt
                      || selectedKrewePerson.availability?.status === "unavailable"
                      || selectedKrewePerson.availability?.status === "called_in"
                    }
                    onClick={() => void requestKreweAction("krewe.schedule_call_in.v1", {
                      baseDate: date,
                      role: kreweRole,
                      note: kreweNote,
                      availabilityConfirmed: true,
                      expectedScheduleUpdatedAt: krewe?.scheduleUpdatedAt,
                    })}
                  >Ask a manager to schedule this call-in</button>
                </div>
              </div>
            ) : null}
            <div className={styles.kreweBoundary}>
              <p>Availability must come from the person or a human confirmation. Scheduling a call-in does not message them or assign a JunkWare job.</p>
              <div>
                <a href={`/crew?date=${encodeURIComponent(date)}&section=call-in`}>Open full call-in plan</a>
                {krewe?.targetDate ? <a href={`/jobs?date=${encodeURIComponent(krewe.targetDate)}`}>Review tomorrow’s jobs</a> : null}
              </div>
            </div>
          </section>

          <section className={styles.communicationsControl} aria-labelledby="opsbot-communications-title">
            <div className={styles.controlTitle}>
              <div><span>Team messages</span><strong id="opsbot-communications-title">Post an internal update and check message problems</strong></div>
              <small data-mode={communications?.mode}>{changeModeLabel(communications?.mode)}</small>
            </div>
            <div className={styles.communicationsSummary}>
              <div data-attention={Boolean(communications?.slack.activeIncidents)}><b>{communications?.slack.activeIncidents || 0}</b><span>Slack incidents</span></div>
              <div><b>{(communications?.whatsapp.photos.incoming || 0) + (communications?.whatsapp.photos.processing || 0)}</b><span>photos processing</span></div>
              <div data-attention={Boolean((communications?.whatsapp.photos.review || 0) + (communications?.whatsapp.photos.failed || 0))}><b>{(communications?.whatsapp.photos.review || 0) + (communications?.whatsapp.photos.failed || 0)}</b><span>photos need review</span></div>
              <div data-attention={Boolean(communications?.podium.recentNeedsResponse)}><b>{communications?.podium.recentNeedsResponse || 0}</b><span>reviews need response</span></div>
            </div>
            <div className={styles.communicationsEvidence}>
              <span>{communications?.slack.deliveredToday || 0} Slack deliveries today</span>
              <span>{communications?.whatsapp.photoConfirmations.delivered || 0} photo updates delivered</span>
              <span data-attention={Boolean(communications?.whatsapp.replies.failed)}>{communications?.whatsapp.replies.failed || 0} WhatsApp reply failures</span>
              <span>{communications?.podium.locations || 0} Podium locations · view only</span>
            </div>
            {communications?.warning ? <div className={styles.dispatchWarning}>{communications.warning}</div> : null}
            <div className={styles.communicationsNotice}>
              <label>
                <span>Internal notice subject</span>
                <input value={slackNoticeSubject} onChange={(event) => setSlackNoticeSubject(event.target.value)} placeholder="Route plan updated" maxLength={80} disabled={Boolean(busy)} />
              </label>
              <label className={styles.communicationsMessage}>
                <span>Ops Command message</span>
                <textarea value={slackNoticeMessage} onChange={(event) => setSlackNoticeMessage(event.target.value)} placeholder="Write the operating update. Do not include customer contact or payment information." maxLength={800} disabled={Boolean(busy)} />
              </label>
              <label>
                <span>Owner</span>
                <input value={slackNoticeOwner} onChange={(event) => setSlackNoticeOwner(event.target.value)} placeholder="Dispatch lead" maxLength={80} disabled={Boolean(busy)} />
              </label>
              <label>
                <span>Next action</span>
                <input value={slackNoticeNextAction} onChange={(event) => setSlackNoticeNextAction(event.target.value)} placeholder="Review the board before departure" maxLength={200} disabled={Boolean(busy)} />
              </label>
              <button
                type="button"
                disabled={
                  Boolean(busy)
                  || slackNoticeSubject.trim().length < 5
                  || slackNoticeMessage.trim().length < 10
                  || slackNoticeOwner.trim().length < 2
                  || slackNoticeNextAction.trim().length < 5
                  || !communications?.slack.enabled
                  || !communications.slack.credentialAvailable
                  || !communications.slack.commandChannelConfigured
                }
                onClick={() => void requestCommunicationsAction()}
              >Ask a manager to post this update</button>
              <small>After approval, this posts only to the internal #ops-command Slack channel.</small>
            </div>
            <div className={styles.communicationsBoundary}>
              <p>This section can post an internal Slack update. It cannot send a customer message.</p>
              <a href="/marketing?section=reviews">Open Podium Reviews</a>
            </div>
          </section>

          <section className={styles.customerContactControl} aria-labelledby="opsbot-customer-contact-title">
            <div className={styles.controlTitle}>
              <div><span>Customer follow-up</span><strong id="opsbot-customer-contact-title">Prepare a call or text for a person to send</strong></div>
              <small data-mode={customerContact?.mode}>{changeModeLabel(customerContact?.mode)}</small>
            </div>
            <div className={styles.customerContactSummary}>
              <div><b>{customerContact?.summary.contactable || 0}</b><span>contactable jobs</span></div>
              <div data-attention={Boolean(customerContact?.summary.approved)}><b>{customerContact?.summary.approved || 0}</b><span>approved plans</span></div>
              <div><b>{customerContact?.summary.outcomesRecorded || 0}</b><span>outcomes recorded</span></div>
              <div data-attention={Boolean(customerContact?.summary.notCompleted)}><b>{customerContact?.summary.notCompleted || 0}</b><span>not completed</span></div>
            </div>
            {customerContact?.warning ? <div className={styles.dispatchWarning}>{customerContact.warning}</div> : null}
            {customerContact?.appointments.length ? (
              <>
                <label>
                  <span>Choose an appointment</span>
                  <select value={selectedCustomerContactAppointmentId} onChange={(event) => setSelectedCustomerContactAppointmentId(event.target.value)} disabled={loading || Boolean(busy)}>
                    {customerContact.appointments.map((appointment) => (
                      <option key={appointment.appointmentId} value={appointment.appointmentId}>
                        {appointment.latestPlan?.status === "approved" && appointment.planCurrent ? "Approved · " : "Plan · "}{appointment.appointmentTime} · {appointment.jkNumber} · {appointment.customerName}
                      </option>
                    ))}
                  </select>
                </label>
                {selectedCustomerContactAppointment ? (
                  <article className={styles.customerContactTarget}>
                    <header>
                      <div><strong>{selectedCustomerContactAppointment.customerName}</strong><small>{selectedCustomerContactAppointment.jkNumber} · {selectedCustomerContactAppointment.appointmentTime} · {selectedCustomerContactAppointment.territory}</small></div>
                      <span>{selectedCustomerContactAppointment.maskedPhone}</span>
                    </header>
                    <p>{selectedCustomerContactAppointment.status || "JunkWare status unavailable"}</p>
                    {selectedCustomerContactAppointment.latestPlan ? (
                      <div className={styles.customerContactReceipt} data-current={selectedCustomerContactAppointment.planCurrent}>
                        <span>{selectedCustomerContactAppointment.planCurrent ? selectedCustomerContactAppointment.latestPlan.status.replaceAll("_", " ") : "Older plan — appointment changed"}</span>
                        <p>{selectedCustomerContactAppointment.latestPlan.channel.toUpperCase()} · {selectedCustomerContactAppointment.latestPlan.owner} · {selectedCustomerContactAppointment.latestPlan.purpose}</p>
                        <small>{selectedCustomerContactAppointment.latestPlan.outcome ? `${selectedCustomerContactAppointment.latestPlan.outcome.replaceAll("_", " ")} · ` : ""}{selectedCustomerContactAppointment.latestPlan.junkwareVerifiedAt ? "Saved in JunkWare" : "Phone carrier did not confirm delivery"}</small>
                      </div>
                    ) : null}
                  </article>
                ) : null}
                {selectedCustomerContactAppointment?.latestPlan?.status === "approved" && selectedCustomerContactAppointment.planCurrent ? (
                  <div className={styles.customerContactOutcome}>
                    <div className={styles.customerContactLaunch}>
                      {selectedCustomerContactAppointment.latestPlan.channel === "phone" ? (
                        <a href={customerPhoneHref(selectedCustomerContactAppointment.phone)}>Call customer</a>
                      ) : (
                        <a href={customerSmsHref(selectedCustomerContactAppointment.phone, selectedCustomerContactAppointment.latestPlan.message)}>Open text message</a>
                      )}
                      <small>This opens the human-controlled phone or message composer; OpsBot does not send.</small>
                    </div>
                    <label>
                      <span>Result reported by the person</span>
                      <select value={customerContactOutcome} onChange={(event) => setCustomerContactOutcome(event.target.value as CustomerContactOutcome)} disabled={Boolean(busy)}>
                        {selectedCustomerContactAppointment.latestPlan.channel === "sms" ? (
                          <><option value="sms_sent">SMS sent — human confirmed</option><option value="sms_not_sent">SMS not sent</option></>
                        ) : (
                          <><option value="reached">Customer reached</option><option value="voicemail">Voicemail left</option><option value="no_answer">No answer</option></>
                        )}
                      </select>
                    </label>
                    <label className={styles.customerContactEvidenceNote}>
                      <span>What happened?</span>
                      <textarea value={customerContactEvidence} onChange={(event) => setCustomerContactEvidence(event.target.value)} placeholder="Write what the person making the call or text confirmed. Do not paste contact or card information." maxLength={1000} disabled={Boolean(busy)} />
                    </label>
                    <button type="button" disabled={Boolean(busy) || customerContactEvidence.trim().length < 5} onClick={() => void recordCustomerContactOutcome()}>Save what happened</button>
                    <small>This adds the result to the JunkWare appointment note. It does not confirm that the customer’s phone received a text.</small>
                  </div>
                ) : selectedCustomerContactAppointment ? (
                  <div className={styles.customerContactPlan}>
                    <label>
                      <span>Channel</span>
                      <select value={customerContactChannel} onChange={(event) => setCustomerContactChannel(event.target.value as CustomerContactChannel)} disabled={Boolean(busy)}>
                        <option value="phone">Phone call</option>
                        <option value="sms">SMS draft</option>
                      </select>
                    </label>
                    <label>
                      <span>Purpose</span>
                      <input value={customerContactPurpose} onChange={(event) => setCustomerContactPurpose(event.target.value)} maxLength={120} disabled={Boolean(busy)} />
                    </label>
                    {customerContactChannel === "sms" ? (
                      <label className={styles.customerContactDraft}>
                        <span>Text message draft</span>
                        <textarea value={customerContactMessage} onChange={(event) => setCustomerContactMessage(event.target.value)} maxLength={500} disabled={Boolean(busy)} />
                      </label>
                    ) : null}
                    <label>
                      <span>Owner</span>
                      <input value={customerContactOwner} onChange={(event) => setCustomerContactOwner(event.target.value)} placeholder="Who will call or text?" maxLength={120} disabled={Boolean(busy)} />
                    </label>
                    <label>
                      <span>Next action</span>
                      <input value={customerContactNextAction} onChange={(event) => setCustomerContactNextAction(event.target.value)} maxLength={240} disabled={Boolean(busy)} />
                    </label>
                    <button type="button" disabled={Boolean(busy) || customerContactPurpose.trim().length < 5 || customerContactOwner.trim().length < 2 || customerContactNextAction.trim().length < 5 || (customerContactChannel === "sms" && customerContactMessage.trim().length < 10)} onClick={() => void requestCustomerContactPlan()}>Ask a manager to approve this plan</button>
                    <small>Approval prepares the call or text for a person. OpsBot does not place the call or press Send.</small>
                  </div>
                ) : null}
              </>
            ) : <div className={styles.empty}>No active JunkWare appointments with a current phone number are available.</div>}
            <div className={styles.customerContactBoundary}>
              <p>OpsBot can prepare the outreach and save the human-confirmed result. A person still makes the call or sends the text.</p>
              <a href={`/jobs?date=${encodeURIComponent(date)}`}>Open Jobs</a>
            </div>
          </section>

          <section className={styles.searchKingsControl} aria-labelledby="opsbot-searchkings-title">
            <div className={styles.controlTitle}>
              <div><span>Missed leads</span><strong id="opsbot-searchkings-title">Decide who follows up and what happens next</strong></div>
              <small data-mode={searchKings?.mode}>{changeModeLabel(searchKings?.mode)}</small>
            </div>
            <div className={styles.searchKingsSummary}>
              <div data-attention={Boolean(searchKings?.summary.lost)}><b>{searchKings?.summary.lost || 0}</b><span>lost leads</span></div>
              <div data-attention={Boolean(searchKings?.summary.needsFollowUp)}><b>{searchKings?.summary.needsFollowUp || 0}</b><span>need follow-up</span></div>
              <div><b>{searchKings?.summary.bookedOrRecovered || 0}</b><span>matched jobs</span></div>
              <div><b>{moneyLabel(searchKings?.summary.completedAttributedRevenue || 0)}</b><span>revenue from completed jobs</span></div>
            </div>
            {searchKings?.warning ? <div className={styles.dispatchWarning}>{searchKings.warning}</div> : null}
            {searchKings?.recoveryLeads.length ? (
              <>
                <label>
                  <span>Choose a lead</span>
                  <select value={selectedSearchKingsCallId} onChange={(event) => setSelectedSearchKingsCallId(event.target.value)} disabled={loading || Boolean(busy)}>
                    {searchKings.recoveryLeads.map((lead) => (
                      <option key={lead.callId} value={lead.callId}>
                        {lead.status === "lost" ? "Lost" : "Follow-up"} · {lead.callerName} · {lead.territory}{lead.potentialRevenue == null ? "" : ` · ${moneyLabel(lead.potentialRevenue)}`}
                      </option>
                    ))}
                  </select>
                </label>
                {selectedSearchKingsLead ? (
                  <article className={styles.searchKingsTarget}>
                    <header>
                      <div><strong>{selectedSearchKingsLead.callerName}</strong><small>{selectedSearchKingsLead.calledAt.slice(0, 10)} · {selectedSearchKingsLead.territory} · score {selectedSearchKingsLead.score ?? "—"}/5</small></div>
                      <span>{selectedSearchKingsLead.status.replaceAll("_", " ")}</span>
                    </header>
                    <p>{selectedSearchKingsLead.summary || "No call summary was supplied by SearchKings."}</p>
                    <div className={styles.searchKingsEvidence}>
                      <span>Came from: {selectedSearchKingsLead.source}</span>
                      <span>Potential revenue: {selectedSearchKingsLead.potentialRevenue == null ? "not provided" : moneyLabel(selectedSearchKingsLead.potentialRevenue)}</span>
                      <span>{selectedSearchKingsLead.matchedAppointment ? `JunkWare ${selectedSearchKingsLead.matchedAppointment.jkNumber || selectedSearchKingsLead.matchedAppointment.appointmentId}` : "No JunkWare match"}</span>
                    </div>
                    {selectedSearchKingsLead.matchedAppointment ? (
                      <small>{selectedSearchKingsLead.matchedAppointment.date} · {selectedSearchKingsLead.matchedAppointment.completed ? `completed · ${moneyLabel(selectedSearchKingsLead.matchedAppointment.realizedRevenue || 0)}` : `booking only · ${selectedSearchKingsLead.matchedAppointment.status}`}</small>
                    ) : null}
                  </article>
                ) : null}
                {selectedSearchKingsLead ? (
                  <div className={styles.searchKingsAction}>
                    <label>
                      <span>New status</span>
                      <select value={searchKingsStatus} onChange={(event) => setSearchKingsStatus(event.target.value as SearchKingsRecoveryStatus)} disabled={Boolean(busy)}>
                        <option value="needs_follow_up">Needs follow-up</option>
                        <option value="lost">Lost</option>
                        <option value="unqualified">Unqualified</option>
                      </select>
                    </label>
                    <label>
                      <span>Reason</span>
                      <select value={searchKingsReason} onChange={(event) => setSearchKingsReason(event.target.value as SearchKingsRecoveryReason)} disabled={Boolean(busy)}>
                        <option value="">No reason selected</option>
                        <option value="availability">Availability</option>
                        <option value="pricing">Pricing</option>
                        <option value="missed_call">Missed call</option>
                        <option value="no_follow_up">No follow-up</option>
                        <option value="competitor">Competitor</option>
                        <option value="out_of_area">Out of area</option>
                        <option value="service_not_offered">Service not offered</option>
                        <option value="customer_declined">Customer declined</option>
                        <option value="other">Other</option>
                      </select>
                    </label>
                    <label>
                      <span>Owner</span>
                      <input value={searchKingsOwner} onChange={(event) => setSearchKingsOwner(event.target.value)} placeholder="Who will handle this?" maxLength={120} disabled={Boolean(busy)} />
                    </label>
                    <label>
                      <span>Next action</span>
                      <input value={searchKingsNextAction} onChange={(event) => setSearchKingsNextAction(event.target.value)} placeholder="What should they do next?" maxLength={500} disabled={Boolean(busy)} />
                    </label>
                    <label className={styles.searchKingsEvidenceNote}>
                      <span>What did you check?</span>
                      <textarea value={searchKingsEvidenceNote} onChange={(event) => setSearchKingsEvidenceNote(event.target.value)} placeholder="Write what you checked. Do not paste contact, password, or payment information." maxLength={1000} disabled={Boolean(busy)} />
                    </label>
                    <label className={styles.searchKingsContactFlag}>
                      <input type="checkbox" checked={searchKingsFranchiseContacted} onChange={(event) => setSearchKingsFranchiseContacted(event.target.checked)} disabled={Boolean(busy)} />
                      <span>I confirmed that the franchise followed up</span>
                    </label>
                    <button
                      type="button"
                      disabled={Boolean(busy) || searchKingsOwner.trim().length < 2 || searchKingsNextAction.trim().length < 5 || searchKingsEvidenceNote.trim().length < (searchKingsFranchiseContacted ? 10 : 5) || ((searchKingsStatus === "lost" || searchKingsStatus === "unqualified") && !searchKingsReason)}
                      onClick={() => void requestSearchKingsRecovery()}
                    >Ask a manager to save this follow-up</button>
                    <small>This updates the OpsCenter follow-up record. It does not call or message the lead.</small>
                  </div>
                ) : null}
              </>
            ) : <div className={styles.empty}>No SearchKings leads need follow-up right now.</div>}
            <div className={styles.searchKingsBoundary}>
              <p>This section saves the owner, status, and next step. It does not contact the lead or change SearchKings.</p>
              <a href="/marketing?section=lost-leads">Open all recovery leads</a>
            </div>
          </section>

          <section className={styles.marketingControl} aria-labelledby="opsbot-marketing-title">
            <datalist id="opsbot-podium-appointment-options">
              {(marketing?.podium.assignmentOptions || []).map((candidate) => (
                <option key={`${candidate.appointmentDate}-${candidate.reference}`} value={candidate.reference}>
                  {candidate.appointmentDate} · {candidate.jkNumber} · {candidate.customerName} · {candidate.crew.join(" + ")}
                </option>
              ))}
            </datalist>
            <div className={styles.controlTitle}>
              <div><span>Google reviews</span><strong id="opsbot-marketing-title">Match a review to the completed job and Krewe</strong></div>
              <small data-mode={marketing?.mode}>{changeModeLabel(marketing?.mode)}</small>
            </div>
            <div className={styles.marketingSummary}>
              <div data-attention={Boolean(marketing?.podium.pendingAttribution)}><b>{marketing?.podium.pendingAttribution || 0}</b><span>unassigned reviews</span></div>
              <div><b>{marketing?.podium.reviews.filter((review) => review.suggestions.length > 0).length || 0}</b><span>suggested jobs</span></div>
              <div data-attention={Boolean(marketing?.podium.recentNeedsResponse)}><b>{marketing?.podium.recentNeedsResponse || 0}</b><span>need response</span></div>
              <div><b>{marketing?.podium.locations || 0}</b><span>Podium locations</span></div>
            </div>
            {marketing?.podium.snapshotAvailable ? (
              <>
                <label>
                  <span>Choose an unmatched review</span>
                  <select value={selectedMarketingReviewUid} onChange={(event) => setSelectedMarketingReviewUid(event.target.value)} disabled={loading || Boolean(busy)}>
                    {marketing.podium.reviews.map((review) => (
                      <option key={review.reviewUid} value={review.reviewUid}>
                        {review.suggestions.length ? "Candidate · " : "Unmatched · "}{review.authorName} · {review.rating} stars
                      </option>
                    ))}
                  </select>
                </label>
                {selectedMarketingReview ? (
                  <article className={styles.marketingReviewTarget}>
                    <header>
                      <div><strong>{selectedMarketingReview.authorName}</strong><small>{selectedMarketingReview.locationName} · {selectedMarketingReview.createdAt.slice(0, 10)}</small></div>
                      <span>{"★".repeat(Math.max(0, Math.min(5, selectedMarketingReview.rating)))}</span>
                    </header>
                    <p>{selectedMarketingReview.body || "Rating submitted without written feedback."}</p>
                    {selectedMarketingReview.suggestions[0] ? (
                      <div className={styles.marketingSuggestion}>
                        <small>{selectedMarketingReview.suggestions[0].matchKind?.replaceAll("_", " ")} candidate</small>
                        <strong>{selectedMarketingReview.suggestions[0].customerName}</strong>
                        <span>{selectedMarketingReview.suggestions[0].jkNumber} · {selectedMarketingReview.suggestions[0].appointmentDate}</span>
                        <p>Krewe: {selectedMarketingReview.suggestions[0].crew.join(" + ")}</p>
                      </div>
                    ) : <div className={styles.marketingNoSuggestion}>No confident name match. Choose the completed appointment explicitly.</div>}
                  </article>
                ) : <div className={styles.empty}>Every recent Podium review has a confirmed appointment and Krewe assignment.</div>}
                {selectedMarketingReview ? (
                  <div className={styles.marketingAttributionAction}>
                    <label>
                      <span>Choose the completed job</span>
                      <input
                        value={marketingAppointmentReference}
                        onChange={(event) => setMarketingAppointmentReference(event.target.value)}
                        list="opsbot-podium-appointment-options"
                        placeholder="Appointment ID or JK number"
                        autoComplete="off"
                        disabled={Boolean(busy)}
                      />
                    </label>
                    {selectedMarketingCandidate ? (
                      <div className={styles.marketingCandidateEvidence}>
                        <strong>{selectedMarketingCandidate.jkNumber}</strong>
                        <span>{selectedMarketingCandidate.customerName} · {selectedMarketingCandidate.appointmentDate}</span>
                        <small>{selectedMarketingCandidate.territory || "Territory unavailable"} · Krewe: {selectedMarketingCandidate.crew.join(" + ")}</small>
                      </div>
                    ) : <div className={styles.marketingNoSuggestion}>Choose the correct completed appointment from the list.</div>}
                    <div className={styles.marketingAttributionButtons}>
                      <button
                        type="button"
                        disabled={Boolean(busy) || !selectedMarketingCandidate || !selectedMarketingReview.suggestions.some((candidate) => candidate.candidateKey === selectedMarketingCandidate.candidateKey)}
                        onClick={() => void requestMarketingAttribution("confirm_suggestion")}
                      >Ask a manager to confirm this match</button>
                      <button
                        type="button"
                        disabled={Boolean(busy) || !selectedMarketingCandidate}
                        onClick={() => void requestMarketingAttribution("reassign")}
                      >Ask a manager to use this job instead</button>
                    </div>
                    <small>Another manager reviews the selected review, job, and Krewe before the match is saved.</small>
                  </div>
                ) : null}
              </>
            ) : <div className={styles.empty}>No Podium Reviews snapshot has been collected yet.</div>}
            <div className={styles.marketingBoundary}>
              <p>This only matches the review to a completed job and Krewe. It does not reply to the review or edit JunkWare.</p>
              <a href="/marketing?section=reviews">Open Marketing Reviews</a>
            </div>
          </section>

          <section className={styles.fleetControl} aria-labelledby="opsbot-fleet-title">
            <div className={styles.controlTitle}>
              <div><span>Trucks</span><strong id="opsbot-fleet-title">Availability, repairs, GPS, and load</strong></div>
              <small data-mode={fleet?.mode}>{changeModeLabel(fleet?.mode)}</small>
            </div>
            <div className={styles.fleetSummary}>
              <div><b>{fleet?.summary.outOfService || 0}</b><span>out of service</span></div>
              <div><b>{fleet?.summary.actionRequired || 0}</b><span>need action</span></div>
              <div><b>{fleet?.summary.activeRepairs || 0}</b><span>active repairs</span></div>
              <div><b>{fleet?.summary.incompleteInspections || 0}</b><span>inspections due</span></div>
            </div>
            {fleet?.warning ? <div className={styles.dispatchWarning}>{fleet.warning}</div> : null}
            <label>
              <span>Choose a truck</span>
              <select value={selectedFleetTruckId} onChange={(event) => setSelectedFleetTruckId(event.target.value)} disabled={loading || Boolean(busy)}>
                {(fleet?.trucks || []).map((truck) => (
                  <option key={truck.truck} value={truck.truck}>{truck.truck} · {fleetReadinessLabel(truck.readiness)}</option>
                ))}
              </select>
            </label>
            {selectedFleetTruck ? (
              <article className={styles.fleetTarget} data-readiness={selectedFleetTruck.readiness}>
                <div>
                  <strong>{selectedFleetTruck.truck}</strong>
                  <span>{fleetReadinessLabel(selectedFleetTruck.readiness)}</span>
                </div>
                <p>{selectedFleetTruck.topAction?.title || "No truck issue needs action right now"}</p>
                <small>{selectedFleetTruck.topAction?.detail || `${selectedFleetTruck.activeIssueCount} active repairs`}</small>
                <small>GPS: {selectedFleetTruck.gpsFreshness} · {selectedFleetTruck.hasVerifiedCoordinate ? "location available" : "location unavailable"}</small>
                <small>Load: {selectedFleetTruck.truckLoad.currentLoadLabel} ({selectedFleetTruck.truckLoad.capacityPercent}%) · {selectedFleetTruck.truckLoad.lastEventLabel}</small>
              </article>
            ) : <div className={styles.empty}>No Fleet truck is available.</div>}

            {selectedFleetTruck && fleet ? (
              <div className={styles.fleetLoadAction}>
                <div className={styles.fleetLoadState} data-over-capacity={selectedFleetTruck.truckLoad.isOverCapacity}>
                  <span>Current truck load</span>
                  <strong>{selectedFleetTruck.truckLoad.currentLoadLabel}</strong>
                  <small>{selectedFleetTruck.truckLoad.currentContents || "Contents not recorded"}</small>
                </div>
                <label>
                  <span>Starting load</span>
                  <select value={fleetStartingLoad} onChange={(event) => setFleetStartingLoad(event.target.value)} disabled={Boolean(busy)}>
                    {truckStartingLoadOptions.map(([value, label]) => <option key={label} value={value}>{label}</option>)}
                  </select>
                </label>
                <button
                  type="button"
                  disabled={Boolean(busy)}
                  onClick={() => void requestFleetAction("fleet.set_starting_load.v1", {
                    date,
                    loadFraction: Number(fleetStartingLoad),
                    expectedStoreUpdatedAt: fleet.truckLoadStoreUpdatedAt,
                  })}
                >Record starting load</button>
                <div className={styles.fleetLoadButtons}>
                  <button
                    type="button"
                    disabled={Boolean(busy)}
                    onClick={() => void requestFleetAction("fleet.record_yard_reset.v1", {
                      date,
                      location: "dump",
                      expectedStoreUpdatedAt: fleet.truckLoadStoreUpdatedAt,
                    })}
                  >Record dump reset</button>
                  <button
                    type="button"
                    disabled={Boolean(busy)}
                    onClick={() => void requestFleetAction("fleet.record_yard_reset.v1", {
                      date,
                      location: "metal_yard",
                      expectedStoreUpdatedAt: fleet.truckLoadStoreUpdatedAt,
                    })}
                  >Record metal-yard reset</button>
                </div>
                <small>These buttons save the load a person observed. They do not move the truck or send it to a dump.</small>
              </div>
            ) : null}

            {selectedFleetTruck?.readiness === "out_of_service" ? (
              selectedFleetTruck.blockingIssues.length === 1 ? (
                <div className={styles.fleetSensitiveAction}>
                  <div className={styles.blockingIssue}>
                    <span>Blocking repair</span>
                    <strong>{selectedFleetTruck.blockingIssues[0].title}</strong>
                    <small>{selectedFleetTruck.blockingIssues[0].status.replace("_", " ")} · {selectedFleetTruck.blockingIssues[0].owner || "No owner assigned"}</small>
                  </div>
                  <label>
                    <span>What repair was completed and checked?</span>
                    <input
                      value={fleetReturnResolution}
                      onChange={(event) => setFleetReturnResolution(event.target.value)}
                      placeholder="Describe the completed repair and how it was checked"
                      maxLength={1000}
                      disabled={Boolean(busy)}
                    />
                  </label>
                  <button
                    type="button"
                    disabled={Boolean(busy) || fleetReturnResolution.trim().length < 5}
                    onClick={() => void requestFleetAction("fleet.return_to_service.v1", {
                      issueId: selectedFleetTruck.blockingIssues[0].issueId,
                      expectedIssueUpdatedAt: selectedFleetTruck.blockingIssues[0].updatedAt,
                      resolution: fleetReturnResolution,
                    })}
                  >Ask a manager to return this truck to service</button>
                  <small>Another manager must approve before the blocking repair is closed.</small>
                </div>
              ) : (
                <div className={styles.fleetBlocker}>
                  This truck has {selectedFleetTruck.blockingIssues.length} blocking repairs. Resolve each work order in the Repair queue before requesting return to service.
                </div>
              )
            ) : selectedFleetTruck ? (
              <div className={styles.fleetSensitiveAction}>
                <label>
                  <span>Out-of-service reason</span>
                  <input
                    value={fleetHoldReason}
                    onChange={(event) => setFleetHoldReason(event.target.value)}
                    placeholder="State the defect or operating risk"
                    maxLength={160}
                    disabled={Boolean(busy)}
                  />
                </label>
                <button
                  type="button"
                  disabled={Boolean(busy) || fleetHoldReason.trim().length < 5}
                  onClick={() => void requestFleetAction("fleet.mark_out_of_service.v1", { reason: fleetHoldReason })}
                >Ask a manager to take this truck out of service</button>
                <small>This creates a blocking repair after approval. A GPS or checklist warning cannot take a truck out of service by itself.</small>
              </div>
            ) : null}
            <div className={styles.fleetBoundary}>
              <p>{fleet?.mode === "live_control"
                ? "OpsCenter checks the repair record after a truck is taken out of service or returned. “No active hold” is not a mechanical safety inspection."
                : "Preview only: these buttons show the process without changing repair records or truck availability."}</p>
              <a href={`/fleet?date=${encodeURIComponent(date)}&view=maintenance&section=overview`}>Open Fleet repair queue</a>
            </div>
          </section>

          <section className={styles.linxupControl} aria-labelledby="opsbot-linxup-title">
            <div className={styles.controlTitle}>
              <div><span>GPS trackers</span><strong id="opsbot-linxup-title">Find tracker problems and assign follow-up</strong></div>
              <small data-mode={linxup?.mode}>{changeModeLabel(linxup?.mode)}</small>
            </div>
            <div className={styles.linxupSummary}>
              <div data-attention={Boolean(linxup?.summary.reviewNeeded)}><b>{linxup?.summary.reviewNeeded || 0}</b><span>need review</span></div>
              <div data-attention={Boolean(linxup?.summary.missingCoordinate)}><b>{linxup?.summary.missingCoordinate || 0}</b><span>no location</span></div>
              <div data-attention={Boolean(linxup?.summary.fallback)}><b>{linxup?.summary.fallback || 0}</b><span>using backup updates</span></div>
              <div><b>{linxup?.summary.reviewed || 0}</b><span>follow-ups saved</span></div>
            </div>
            {linxup?.warning ? <div className={styles.dispatchWarning}>{linxup.warning}</div> : null}
            <label>
              <span>Choose a truck tracker</span>
              <select value={selectedLinxupTruckId} onChange={(event) => setSelectedLinxupTruckId(event.target.value)} disabled={loading || Boolean(busy)}>
                {(linxup?.devices || []).map((device) => (
                  <option key={device.truck} value={device.truck}>{device.truck} · {device.freshness} · {trackerMatchLabel(device.mappingStatus)}</option>
                ))}
              </select>
            </label>
            {selectedLinxupDevice ? (
              <article className={styles.linxupTarget} data-freshness={selectedLinxupDevice.freshness}>
                <div><strong>{selectedLinxupDevice.truck}</strong><span>{selectedLinxupDevice.freshness}</span></div>
                <p>{selectedLinxupDevice.attentionReason}</p>
                <small>Connection: {trackerConnectionLabel(selectedLinxupDevice.deliveryMode)} · {trackerMatchLabel(selectedLinxupDevice.mappingStatus)} · {selectedLinxupDevice.hasVerifiedCoordinate ? "location available" : "location unavailable"}</small>
                <small>Last GPS update: {selectedLinxupDevice.lastGpsUpdate || "Unavailable"}</small>
                {selectedLinxupDevice.review ? (
                  <div className={styles.linxupReviewReceipt}>
                    <span>{linxupFollowUpLabel(selectedLinxupDevice.review.disposition)} · {selectedLinxupDevice.reviewCurrent ? "current" : "older — tracker changed"}</span>
                    <p>{selectedLinxupDevice.review.note}</p>
                    <small>Recorded by {selectedLinxupDevice.review.updatedBy || "OpsCenter"} · {selectedLinxupDevice.review.updatedAt}</small>
                  </div>
                ) : null}
              </article>
            ) : <div className={styles.empty}>No LinxUp tracker information is available for this date.</div>}
            {selectedLinxupDevice ? (
              <div className={styles.linxupReviewAction}>
                <label>
                  <span>What should happen?</span>
                  <select value={linxupDisposition} onChange={(event) => setLinxupDisposition(event.target.value as LinxupControlDisposition)} disabled={Boolean(busy)}>
                    <option value="monitor">Keep watching</option>
                    <option value="provider_follow_up">Contact LinxUp</option>
                    <option value="mapping_follow_up">Check which tracker is in the truck</option>
                    <option value="no_issue_confirmed">Nothing is wrong</option>
                  </select>
                </label>
                <label>
                  <span>What did you check?</span>
                  <input value={linxupReviewNote} onChange={(event) => setLinxupReviewNote(event.target.value)} placeholder="Describe what you checked and who should follow up" maxLength={1000} disabled={Boolean(busy)} />
                </label>
                <button type="button" disabled={Boolean(busy) || linxupReviewNote.trim().length < 5} onClick={() => void requestLinxupReview()}>Ask a manager to save this follow-up</button>
                <small>This saves the follow-up plan only. It does not change the tracker, map, or truck availability.</small>
              </div>
            ) : null}
            <div className={styles.linxupBoundary}>
              <p>GPS locations still come from LinxUp. This section only records what a person checked and who follows up.</p>
              <a href={`/fleet?date=${encodeURIComponent(date)}&view=live`}>Open live Fleet map</a>
            </div>
          </section>

          <section className={styles.financeControl} aria-labelledby="opsbot-finance-title">
            <div className={styles.controlTitle}>
              <div><span>Money &amp; payroll</span><strong id="opsbot-finance-title">Check payments, bonuses, and payroll corrections</strong></div>
              {finance ? <small data-mode={finance.mode}>{changeModeLabel(finance.mode)}</small> : null}
            </div>
            {financeAccessDenied ? (
              <div className={styles.financeAccess}>Only a manager or administrator can view and change Finance information. The rest of the dashboard is still available.</div>
            ) : finance ? (
              <>
                <div className={styles.financeSummary}>
                  <div data-status={finance.paymentReconciliation.status}>
                    <b>{reconciliationLabel(finance.paymentReconciliation.status)}</b><span>payments</span>
                  </div>
                  <div><b>{finance.paymentReconciliation.exceptionCount}</b><span>payment differences</span></div>
                  <div><b>{moneyLabel(finance.paymentReconciliation.summary.net_difference)}</b><span>net difference</span></div>
                  <div><b>{finance.payrollCorrections.count}</b><span>payroll corrections</span></div>
                </div>
                <div className={styles.financeEvidence}>
                  <span>JunkWare {moneyLabel(finance.paymentReconciliation.summary.junkware_total)}</span>
                  <span>QBO {moneyLabel(finance.paymentReconciliation.summary.merchant_center_total)}</span>
                  <span>{finance.paymentReconciliation.currentReviewCount} follow-ups saved</span>
                  <span>{finance.manualBonuses.count} bonuses · {moneyLabel(finance.manualBonuses.totalAmount)}</span>
                </div>
                {finance.paymentReconciliation.exceptions.length > 0 ? (
                  <div className={styles.paymentReviewControl}>
                    <div className={styles.paymentReviewHead}>
                      <div><strong>Payment difference follow-up</strong><small>Another manager must approve</small></div>
                      <label>
                        <span>Choose a payment difference</span>
                        <select value={selectedFinanceExceptionId} onChange={(event) => setSelectedFinanceExceptionId(event.target.value)} disabled={loading || Boolean(busy)}>
                          {finance.paymentReconciliation.exceptions.map((exception) => (
                            <option key={exception.exceptionId} value={exception.exceptionId}>
                              {exception.type} · {exception.reference} · {exception.reviewCurrent ? "reviewed" : "open"}
                            </option>
                          ))}
                        </select>
                      </label>
                    </div>
                    {selectedFinanceException ? (
                      <>
                        <div className={styles.paymentExceptionTarget}>
                          <div><strong>{selectedFinanceException.type}</strong><span>{selectedFinanceException.reference}</span></div>
                          <p>JunkWare {selectedFinanceException.junkwareAmount == null ? "—" : moneyLabel(selectedFinanceException.junkwareAmount)} · QBO {selectedFinanceException.qboAmount == null ? "—" : moneyLabel(selectedFinanceException.qboAmount)}</p>
                        </div>
                        {selectedFinanceException.review ? (
                          <div className={styles.paymentReviewReceipt} data-current={selectedFinanceException.reviewCurrent}>
                            <span>{selectedFinanceException.reviewCurrent ? "Current follow-up" : "Older follow-up — numbers changed"}</span>
                            <p>{selectedFinanceException.review.owner} · {selectedFinanceException.review.nextAction}</p>
                            <small>{paymentFollowUpLabel(selectedFinanceException.review.disposition)} · saved by {selectedFinanceException.review.updatedBy}</small>
                          </div>
                        ) : null}
                        <div className={styles.paymentReviewForm}>
                          <label>
                            <span>What should happen?</span>
                            <select value={paymentReviewDisposition} onChange={(event) => {
                              const disposition = event.target.value as PaymentReviewDisposition;
                              setPaymentReviewDisposition(disposition);
                              setPaymentReviewNextStep(paymentReviewNextAction(disposition));
                            }} disabled={Boolean(busy)}>
                              <option value="keep_open">Leave it open</option>
                              <option value="qbo_follow_up">QBO follow-up</option>
                              <option value="junkware_follow_up">JunkWare follow-up</option>
                              <option value="refund_verification">Check a refund</option>
                              <option value="no_issue_confirmed">The difference is expected</option>
                            </select>
                          </label>
                          <label>
                            <span>Owner</span>
                            <input value={paymentReviewOwner} onChange={(event) => setPaymentReviewOwner(event.target.value)} placeholder="Accountable manager" maxLength={80} disabled={Boolean(busy)} />
                          </label>
                          <label className={styles.paymentReviewNextAction}>
                            <span>Next action</span>
                            <input value={paymentReviewNextStep} onChange={(event) => setPaymentReviewNextStep(event.target.value)} placeholder="What should the owner check next?" maxLength={240} disabled={Boolean(busy)} />
                          </label>
                          <label className={styles.paymentReviewEvidence}>
                            <span>What did you check?</span>
                            <input value={paymentReviewNote} onChange={(event) => setPaymentReviewNote(event.target.value)} placeholder="Describe what you checked. Do not enter card or contact information." maxLength={1000} disabled={Boolean(busy)} />
                          </label>
                          <button
                            type="button"
                            disabled={Boolean(busy) || paymentReviewOwner.trim().length < 2 || paymentReviewNextStep.trim().length < 5 || paymentReviewNote.trim().length < 5}
                            onClick={() => void requestPaymentExceptionReview()}
                          >Ask a manager to save this follow-up</button>
                          <small>This saves the owner and next step. It does not change QBO, JunkWare, or the payment amount.</small>
                        </div>
                      </>
                    ) : null}
                  </div>
                ) : (
                  <div className={styles.paymentReviewEmpty}>No payment difference needs review right now.</div>
                )}
                <label>
                  <span>Finance employee</span>
                  <select value={selectedFinanceEmployeeName} onChange={(event) => setSelectedFinanceEmployeeName(event.target.value)} disabled={loading || Boolean(busy)}>
                    {finance.employees.map((employee) => <option key={employee.normalizedName} value={employee.name}>{employee.name}</option>)}
                  </select>
                </label>
                {selectedFinanceEmployee ? (
                  <div className={styles.financeActions}>
                    <article className={styles.financeAction}>
                      <div><strong>Manual bonus</strong><small>Another manager must approve</small></div>
                      <div className={styles.financeInputGrid}>
                        <label>
                          <span>Amount</span>
                          <input type="number" min="0.01" max="10000" step="0.01" inputMode="decimal" value={bonusAmount} onChange={(event) => setBonusAmount(event.target.value)} placeholder="$0.00" disabled={Boolean(busy)} />
                        </label>
                        <label>
                          <span>Reason and proof</span>
                          <input value={bonusNote} onChange={(event) => setBonusNote(event.target.value)} placeholder="Explain why the bonus was earned" maxLength={1000} disabled={Boolean(busy)} />
                        </label>
                      </div>
                      <button
                        type="button"
                        disabled={Boolean(busy) || Number(bonusAmount) <= 0 || Number(bonusAmount) > 10_000 || bonusNote.trim().length < 5}
                        onClick={() => void requestFinanceAction("finance.record_manual_bonus.v1", {
                          amount: Number(bonusAmount),
                          note: bonusNote,
                          expectedBonusStoreUpdatedAt: finance.manualBonuses.storeUpdatedAt,
                        })}
                      >Ask a manager to approve this bonus</button>
                    </article>
                    <article className={styles.financeAction}>
                      <div><strong>Payroll correction</strong><small>Another manager must approve</small></div>
                      <div className={styles.payrollTimeGrid}>
                        <label><span>Clock in</span><input value={payrollClockIn} onChange={(event) => setPayrollClockIn(event.target.value)} placeholder="08:00 AM" disabled={Boolean(busy)} /></label>
                        <label><span>Clock out</span><input value={payrollClockOut} onChange={(event) => setPayrollClockOut(event.target.value)} placeholder="04:30 PM" disabled={Boolean(busy)} /></label>
                        <label><span>Hourly rate</span><input type="number" min="0.01" max="500" step="0.01" inputMode="decimal" value={payrollHourlyRate} onChange={(event) => setPayrollHourlyRate(event.target.value)} placeholder="$0.00" disabled={Boolean(busy)} /></label>
                      </div>
                      <label><span>Reason and proof</span><input value={payrollNote} onChange={(event) => setPayrollNote(event.target.value)} placeholder="Explain what the timecard should show" maxLength={1000} disabled={Boolean(busy)} /></label>
                      <button
                        type="button"
                        disabled={Boolean(busy) || payrollClockIn.trim().length < 7 || Number(payrollHourlyRate) <= 0 || Number(payrollHourlyRate) > 500 || payrollNote.trim().length < 5}
                        onClick={() => void requestFinanceAction("finance.record_payroll_correction.v1", {
                          clockIn: payrollClockIn,
                          clockOut: payrollClockOut,
                          hourlyRate: Number(payrollHourlyRate),
                          note: payrollNote,
                          expectedPayrollStoreUpdatedAt: finance.payrollCorrections.storeUpdatedAt,
                          expectedCorrectionUpdatedAt: selectedFinanceEmployee.correctionUpdatedAt,
                        })}
                      >Ask a manager to approve this correction</button>
                    </article>
                  </div>
                ) : <div className={styles.empty}>No employee is available in payroll for this date.</div>}
                <div className={styles.financeBoundary}>
                  <p>Payment totals come from JunkWare and QBO. This dashboard can save follow-up notes, bonuses, and payroll corrections, but it cannot post or refund a QBO transaction.</p>
                  <div>
                    <a href={`/finance?date=${encodeURIComponent(date)}&view=daily&section=payments`}>Open payment check</a>
                    <a href={`/crew?date=${encodeURIComponent(date)}&section=pay-period`}>Open pay period</a>
                  </div>
                </div>
              </>
            ) : <div className={styles.empty}>Loading Finance information…</div>}
          </section>

          <div className={styles.controlTitle}>
            <div><span>My follow-up list</span><strong>Choose an item and take the next step</strong></div>
          </div>
          <label>
            <span>Choose an item</span>
            <select value={selectedId} onChange={(event) => setSelectedId(event.target.value)} disabled={loading || Boolean(busy)}>
              {(inbox?.items || []).map((item) => (
                <option key={item.id} value={item.id}>{item.title} · {item.status.replaceAll("_", " ")}</option>
              ))}
            </select>
          </label>

          {selected ? (
            <article className={styles.target}>
              <div><span data-severity={selected.severity}>{selected.severity}</span><small>{selected.category}</small></div>
              <strong>{selected.title}</strong>
              <p>{selected.description}</p>
              <small>Next step: {selected.recommendedAction}</small>
            </article>
          ) : (
            <div className={styles.empty}>No follow-up item is available for this date.</div>
          )}

          {selected && activeItem(selected) && supportsCloseoutCorrection(selected) ? (
            <section className={styles.closeoutPack} aria-label="JunkWare closeout correction">
              <div className={styles.closeoutPackHead}>
                <div><span>Fix a completed job</span><strong>Correct the crew, charge, time, or payment</strong></div>
                <small>Another manager must approve</small>
              </div>
              <p>Load the current JunkWare closeout, fix the fields shown, then ask another manager to approve the correction.</p>
              <JobCloseoutEditor
                key={`${selected.id}:${selected.version}`}
                appointmentId={selected.entity.id}
                appointmentUrl=""
                initialStatus="Completed"
                serviceDate={selected.operatingDate}
                governed={{
                  workItemId: selected.id,
                  expectedWorkItemVersion: selected.version,
                  onActionRequested: load,
                }}
              />
              <small className={styles.closeoutBoundary}>Preview only does not save anything. With live changes enabled, OpsCenter checks JunkWare again before saving and confirms the result afterward.</small>
            </section>
          ) : selected?.entity.type === "job" ? (
            <div className={styles.closeoutUnavailable}>
              <strong>This item cannot be fixed from this dashboard.</strong>
              <span>Use the next step shown above. The closeout editor appears only for supported crew or payment problems.</span>
              {selected.href ? <a href={selected.href}>Open related job</a> : null}
            </div>
          ) : null}

          {selected ? (
            <div className={styles.commands} aria-label="Available OpsBot commands">
              {selected.status === "open" ? <button type="button" disabled={Boolean(busy)} onClick={() => void requestWorkAction("work.acknowledge.v1")}>Acknowledge</button> : null}
              {selected.ownerActorId !== inbox?.actor.id ? <button type="button" disabled={Boolean(busy)} onClick={() => void requestWorkAction("work.assign_self.v1")}>Assign to me</button> : null}
              {activeItem(selected) ? <button type="button" disabled={Boolean(busy)} onClick={() => void requestWorkAction("work.snooze.v1", { until: new Date(Date.now() + 60 * 60_000).toISOString() })}>Snooze 1 hour</button> : null}
              {!activeItem(selected) ? <button type="button" disabled={Boolean(busy)} onClick={() => void requestWorkAction("work.reopen.v1")}>Reopen</button> : null}
            </div>
          ) : null}

          {selected && activeItem(selected) ? (
            <div className={styles.sensitiveCommand}>
              <label>
                <span>Why is this finished?</span>
                <input value={resolutionReason} onChange={(event) => setResolutionReason(event.target.value)} placeholder="Explain what was fixed and where you checked it" />
              </label>
              <button
                type="button"
                disabled={Boolean(busy) || resolutionReason.trim().length < 3}
                onClick={() => void requestWorkAction("work.resolve_manually.v1", { reason: resolutionReason })}
              >
                Ask a manager to close this item
              </button>
              <small>Another manager must approve because this removes the item from the active list.</small>
            </div>
          ) : null}
        </div>

        <aside className={styles.ledger}>
          <div className={styles.ledgerHead}>
            <div><span>Recent activity</span><strong>{snapshot?.summary.total || 0} recorded</strong></div>
            <div><b>{snapshot?.summary.awaitingApproval || 0}</b> waiting</div>
            <div><b>{snapshot?.summary.succeeded || 0}</b> done</div>
            <div><b>{snapshot?.summary.failed || 0}</b> failed</div>
          </div>
          <div className={styles.runs}>
            {recentRuns.map((run) => (
              <article key={run.id} data-status={run.status}>
                <div>
                  <strong>{actionLabel(run.actionKey)}</strong>
                  <span>{statusLabel(run.status)}</span>
                </div>
                <small>{activitySummary(run)}</small>
                {run.status === "awaiting_approval" ? (
                  run.riskClass >= 2 && run.actorId === inbox?.actor.id
                    ? <div className={styles.approvals}>
                        <small className={styles.separateApprover}>A different manager or administrator must approve.</small>
                        <button type="button" disabled={Boolean(busy)} onClick={() => void approve(run, "denied")}>Withdraw</button>
                      </div>
                    : <div className={styles.approvals}>
                        <button type="button" disabled={Boolean(busy)} onClick={() => void approve(run, "approved")}>Approve</button>
                        <button type="button" disabled={Boolean(busy)} onClick={() => void approve(run, "denied")}>Deny</button>
                      </div>
                ) : null}
              </article>
            ))}
            {!loading && !recentRuns.length ? <div className={styles.empty}>No dashboard activity has been recorded yet.</div> : null}
          </div>
        </aside>
      </div>
    </section>
  );
}
