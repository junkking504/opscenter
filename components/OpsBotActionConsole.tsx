"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { ActionRun } from "@/lib/platform/contracts";
import type { InboxPayload, InboxWorkItem } from "@/lib/platform/inbox";
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
};

type FleetSnapshot = {
  date: string;
  mode: "live_control" | "preview_simulation";
  source: string;
  sourceObservedAt: string;
  storeUpdatedAt: string;
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
    requested: "Requested",
    awaiting_approval: "Awaiting approval",
    denied: "Denied",
    queued: "Queued",
    running: "Running",
    verifying: "Verifying",
    succeeded: "Verified",
    failed: "Failed",
    cancelled: "Cancelled",
  };
  return labels[status];
}

function actionLabel(actionKey: string): string {
  const labels: Record<string, string> = {
    "work.acknowledge.v1": "Acknowledge",
    "work.assign_self.v1": "Assign to me",
    "work.snooze.v1": "Snooze",
    "work.reopen.v1": "Reopen",
    "work.resolve_manually.v1": "Manual resolution",
    "dispatch.assign_truck.v1": "Truck assignment",
    "dispatch.call_ahead.v1": "Call ahead",
    "dispatch.reschedule_time.v1": "Time reschedule",
    "dispatch.cancel_appointment.v1": "Appointment cancellation",
    "dispatch.move_date.v1": "Cross-date move",
    "fleet.mark_out_of_service.v1": "Fleet out-of-service hold",
    "fleet.return_to_service.v1": "Fleet return to service",
    "finance.record_manual_bonus.v1": "Finance manual bonus",
    "finance.record_payroll_correction.v1": "Finance payroll correction",
    "finance.record_payment_exception_review.v1": "Payment exception review",
    "krewe.record_availability.v1": "Krewe availability",
    "krewe.schedule_call_in.v1": "Krewe call-in commitment",
    "communications.post_ops_command_notice.v1": "Ops Command Slack notice",
    "linxup.record_device_review.v1": "LinxUp device review",
  };
  return labels[actionKey] || actionKey;
}

function activeItem(item: InboxWorkItem): boolean {
  return !["resolved", "dismissed"].includes(item.status);
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

function paymentReviewNextAction(disposition: PaymentReviewDisposition): string {
  if (disposition === "qbo_follow_up") return "Verify the transaction in QBO and refresh reconciliation.";
  if (disposition === "junkware_follow_up") return "Verify the payment in JunkWare and refresh reconciliation.";
  if (disposition === "refund_verification") return "Verify correction or refund evidence in QBO before refreshing.";
  if (disposition === "no_issue_confirmed") return "Document why the source exception remains expected.";
  return "Keep open until refreshed source evidence resolves the exception.";
}

const dispatchTimeOptions = Array.from({ length: 24 }, (_, hour) => hour * 60);

export default function OpsBotActionConsole({ date, enabled }: { date: string; enabled: boolean }) {
  const [inbox, setInbox] = useState<InboxPayload | null>(null);
  const [snapshot, setSnapshot] = useState<ActionSnapshot | null>(null);
  const [dispatch, setDispatch] = useState<DispatchSnapshot | null>(null);
  const [fleet, setFleet] = useState<FleetSnapshot | null>(null);
  const [linxup, setLinxup] = useState<LinxupSnapshot | null>(null);
  const [krewe, setKrewe] = useState<KreweSnapshot | null>(null);
  const [communications, setCommunications] = useState<CommunicationsSnapshot | null>(null);
  const [finance, setFinance] = useState<FinanceSnapshot | null>(null);
  const [financeAccessDenied, setFinanceAccessDenied] = useState(false);
  const [selectedId, setSelectedId] = useState("");
  const [selectedAppointmentId, setSelectedAppointmentId] = useState("");
  const [selectedFleetTruckId, setSelectedFleetTruckId] = useState("");
  const [selectedLinxupTruckId, setSelectedLinxupTruckId] = useState("");
  const [selectedKreweEmployeeName, setSelectedKreweEmployeeName] = useState("");
  const [selectedFinanceEmployeeName, setSelectedFinanceEmployeeName] = useState("");
  const [selectedFinanceExceptionId, setSelectedFinanceExceptionId] = useState("");
  const [dispatchTruck, setDispatchTruck] = useState("");
  const [dispatchStartMinutes, setDispatchStartMinutes] = useState("");
  const [dispatchDestinationDate, setDispatchDestinationDate] = useState(date);
  const [cancellationReason, setCancellationReason] = useState("");
  const [fleetHoldReason, setFleetHoldReason] = useState("");
  const [fleetReturnResolution, setFleetReturnResolution] = useState("");
  const [linxupDisposition, setLinxupDisposition] = useState<LinxupControlDisposition>("monitor");
  const [linxupReviewNote, setLinxupReviewNote] = useState("");
  const [kreweNote, setKreweNote] = useState("");
  const [kreweRole, setKreweRole] = useState<"driver" | "crew">("crew");
  const [slackNoticeSubject, setSlackNoticeSubject] = useState("");
  const [slackNoticeMessage, setSlackNoticeMessage] = useState("");
  const [slackNoticeOwner, setSlackNoticeOwner] = useState("");
  const [slackNoticeNextAction, setSlackNoticeNextAction] = useState("");
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
  const [resolutionReason, setResolutionReason] = useState("");
  const [loading, setLoading] = useState(enabled);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    if (!enabled) return;
    setLoading(true);
    setError("");
    try {
      const [inboxPayload, actionPayload, dispatchPayload, fleetPayload, linxupPayload, krewePayload, communicationsPayload, financeResult] = await Promise.all([
        responseJson<InboxPayload>(await fetch("/api/inbox/reconcile", {
          method: "POST",
          cache: "no-store",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ date }),
        })),
        responseJson<ActionSnapshot>(await fetch("/api/platform/action-runs", { cache: "no-store" })),
        responseJson<DispatchSnapshot>(await fetch(`/api/platform/dispatch?date=${encodeURIComponent(date)}`, { cache: "no-store" })),
        responseJson<FleetSnapshot>(await fetch(`/api/platform/fleet?date=${encodeURIComponent(date)}`, { cache: "no-store" })),
        responseJson<LinxupSnapshot>(await fetch(`/api/platform/linxup?date=${encodeURIComponent(date)}`, { cache: "no-store" })),
        responseJson<KreweSnapshot>(await fetch(`/api/platform/krewe?date=${encodeURIComponent(date)}`, { cache: "no-store" })),
        responseJson<CommunicationsSnapshot>(await fetch(`/api/platform/communications?date=${encodeURIComponent(date)}`, { cache: "no-store" })),
        fetch(`/api/platform/finance?date=${encodeURIComponent(date)}`, { cache: "no-store" }).then(async (response) => {
          if (response.status === 403) return { payload: null, accessDenied: true };
          return { payload: await responseJson<FinanceSnapshot>(response), accessDenied: false };
        }),
      ]);
      setInbox(inboxPayload);
      setSnapshot(actionPayload);
      setDispatch(dispatchPayload);
      setFleet(fleetPayload);
      setLinxup(linxupPayload);
      setKrewe(krewePayload);
      setCommunications(communicationsPayload);
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
        : linxupPayload.devices.find((item) => item.attentionReason !== "Current device evidence is available.")?.truck || linxupPayload.devices[0]?.truck || "");
      setSelectedKreweEmployeeName((current) => current && krewePayload.people.some((person) => person.name === current)
        ? current
        : krewePayload.people.find((person) => person.recommendedForCallIn)?.name || krewePayload.people[0]?.name || "");
      setSelectedFinanceEmployeeName((current) => current && financeResult.payload?.employees.some((employee) => employee.name === current)
        ? current
        : financeResult.payload?.employees[0]?.name || "");
      setSelectedFinanceExceptionId((current) => current && financeResult.payload?.paymentReconciliation.exceptions.some((exception) => exception.exceptionId === current)
        ? current
        : financeResult.payload?.paymentReconciliation.exceptions.find((exception) => !exception.reviewCurrent)?.exceptionId
          || financeResult.payload?.paymentReconciliation.exceptions[0]?.exceptionId
          || "");
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Unable to load OpsBot control state.");
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
  const selectedFinanceEmployee = useMemo(
    () => finance?.employees.find((employee) => employee.name === selectedFinanceEmployeeName) || null,
    [finance, selectedFinanceEmployeeName],
  );
  const selectedFinanceException = useMemo(
    () => finance?.paymentReconciliation.exceptions.find((exception) => exception.exceptionId === selectedFinanceExceptionId) || null,
    [finance, selectedFinanceExceptionId],
  );
  useEffect(() => {
    setDispatchTruck(selectedAppointment?.effectiveTruck || "");
    setDispatchStartMinutes(selectedAppointment?.appointmentStartMinutes == null ? "" : String(selectedAppointment.appointmentStartMinutes));
    setDispatchDestinationDate(date);
    setCancellationReason("");
  }, [date, selectedAppointment]);
  useEffect(() => {
    setFleetHoldReason("");
    setFleetReturnResolution("");
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
      setError(requestError instanceof Error ? requestError.message : "The action request failed.");
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
      setError(requestError instanceof Error ? requestError.message : "The dispatch action request failed.");
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
      setError(requestError instanceof Error ? requestError.message : "The Fleet action request failed.");
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
      setError(requestError instanceof Error ? requestError.message : "The LinxUp review request failed.");
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
      setError(requestError instanceof Error ? requestError.message : "The Krewe action request failed.");
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
      setError(requestError instanceof Error ? requestError.message : "The Finance action request failed.");
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
      setError(requestError instanceof Error ? requestError.message : "The payment-exception review request failed.");
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
      setError(requestError instanceof Error ? requestError.message : "The Communications action request failed.");
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
      setError(approvalError instanceof Error ? approvalError.message : "The approval decision failed.");
    } finally {
      setBusy("");
    }
  }

  if (!enabled) {
    return (
      <section className={`${styles.console} ${styles.disabled}`} aria-labelledby="opsbot-command-title">
        <div>
          <span>Command runtime</span>
          <h3 id="opsbot-command-title">Controlled execution is staged</h3>
          <p>Enable the platform kernel in an isolated runtime to create durable action runs, approvals, verification receipts, and audit history.</p>
        </div>
        <strong>Read-only</strong>
      </section>
    );
  }

  return (
    <section className={styles.console} aria-labelledby="opsbot-command-title">
      <div className={styles.head}>
        <div>
          <span>Command runtime</span>
          <h3 id="opsbot-command-title">Control OpsCenter through registered actions</h3>
          <p>Every command records identity, policy, execution, verification, and recovery evidence.</p>
        </div>
        <button type="button" onClick={() => void load()} disabled={loading || Boolean(busy)}>
          {loading ? "Syncing…" : "Refresh state"}
        </button>
      </div>

      {error ? <div className={styles.error} role="alert">{error}</div> : null}

      <div className={styles.workspace}>
        <div className={styles.commandPane}>
          <section className={styles.dispatchControl} aria-labelledby="opsbot-dispatch-title">
            <div className={styles.controlTitle}>
              <div><span>Dispatch control pack</span><strong id="opsbot-dispatch-title">Appointment command</strong></div>
              <small data-mode={dispatch?.mode}>{dispatch?.mode === "live_control" ? "Mission Control" : "Preview simulation"}</small>
            </div>
            {dispatch?.warning ? <div className={styles.dispatchWarning}>{dispatch.warning}</div> : null}
            <label>
              <span>Verified appointment</span>
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
            ) : <div className={styles.empty}>No active verified appointment is available for this date.</div>}
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
                  Request truck approval
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
                  >Request time approval</button>
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
                  >Request date move approval</button>
                  <small>The destination uses the requested time above. JunkWare must retain and read back both fields.</small>
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
                  >Request cancellation approval</button>
                  <small>Cancellation is risk class 3 and requires a different manager or administrator.</small>
                </div>
              </div>
            ) : null}
            <p className={styles.dispatchBoundary}>
              {dispatch?.mode === "live_control"
                ? "Truck and time changes require approval; cross-date moves and cancellation are risk class 3. Every result is read back from JunkWare."
                : "Simulation proves policy and verification without changing shared Dispatch, cancellation state, or JunkWare."}
            </p>
          </section>

          <section className={styles.kreweControl} aria-labelledby="opsbot-krewe-title">
            <div className={styles.controlTitle}>
              <div><span>Krewe control pack</span><strong id="opsbot-krewe-title">Tomorrow’s staffing command</strong></div>
              <small data-mode={krewe?.mode}>{krewe?.mode === "live_control" ? "Mission Control" : "Preview simulation"}</small>
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
              <span>{krewe?.summary.requiredHeadcount || 0} target headcount</span>
            </div>
            {krewe?.warning ? <div className={styles.dispatchWarning}>{krewe.warning}</div> : null}
            <label>
              <span>Krewe employee · {krewe?.targetDate || "tomorrow"}</span>
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
                {selectedKrewePerson.availability?.note ? <small>Recorded evidence: {selectedKrewePerson.availability.note}</small> : null}
              </article>
            ) : <div className={styles.empty}>No authoritative Krewe roster is available.</div>}
            {selectedKrewePerson ? (
              <div className={styles.kreweActions}>
                <label>
                  <span>Human confirmation note</span>
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
                  >Request call-in approval</button>
                </div>
              </div>
            ) : null}
            <div className={styles.kreweBoundary}>
              <p>{krewe?.authorityNotice || "Krewe planning remains read-only until authoritative data is available."}</p>
              <div>
                <a href={`/crew?date=${encodeURIComponent(date)}&section=call-in`}>Open full call-in plan</a>
                {krewe?.targetDate ? <a href={`/jobs?date=${encodeURIComponent(krewe.targetDate)}`}>Review tomorrow’s jobs</a> : null}
              </div>
            </div>
          </section>

          <section className={styles.communicationsControl} aria-labelledby="opsbot-communications-title">
            <div className={styles.controlTitle}>
              <div><span>Communications control pack</span><strong id="opsbot-communications-title">Internal notice + delivery readiness</strong></div>
              <small data-mode={communications?.mode}>{communications?.mode === "live_control" ? "Mission Control" : "Preview simulation"}</small>
            </div>
            <div className={styles.communicationsSummary}>
              <div data-attention={Boolean(communications?.slack.activeIncidents)}><b>{communications?.slack.activeIncidents || 0}</b><span>Slack incidents</span></div>
              <div><b>{(communications?.whatsapp.photos.incoming || 0) + (communications?.whatsapp.photos.processing || 0)}</b><span>photos processing</span></div>
              <div data-attention={Boolean((communications?.whatsapp.photos.review || 0) + (communications?.whatsapp.photos.failed || 0))}><b>{(communications?.whatsapp.photos.review || 0) + (communications?.whatsapp.photos.failed || 0)}</b><span>photo exceptions</span></div>
              <div data-attention={Boolean(communications?.podium.recentNeedsResponse)}><b>{communications?.podium.recentNeedsResponse || 0}</b><span>reviews need response</span></div>
            </div>
            <div className={styles.communicationsEvidence}>
              <span>{communications?.slack.deliveredToday || 0} Slack deliveries today</span>
              <span>{communications?.whatsapp.photoConfirmations.delivered || 0} verified photo confirmations</span>
              <span data-attention={Boolean(communications?.whatsapp.replies.failed)}>{communications?.whatsapp.replies.failed || 0} WhatsApp reply failures</span>
              <span>{communications?.podium.locations || 0} Podium locations · read-only</span>
            </div>
            {communications?.warning ? <div className={styles.dispatchWarning}>{communications.warning}</div> : null}
            <div className={styles.communicationsNotice}>
              <label>
                <span>Internal notice subject</span>
                <input value={slackNoticeSubject} onChange={(event) => setSlackNoticeSubject(event.target.value)} placeholder="Route plan updated" maxLength={80} disabled={Boolean(busy)} />
              </label>
              <label className={styles.communicationsMessage}>
                <span>Ops Command message</span>
                <textarea value={slackNoticeMessage} onChange={(event) => setSlackNoticeMessage(event.target.value)} placeholder="State the verified operating update. Do not include customer contact or payment data." maxLength={800} disabled={Boolean(busy)} />
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
              >Request Slack notice approval</button>
              <small>Risk class 2. A different manager or administrator must approve; delivery is restricted to the owned internal #ops-command channel.</small>
            </div>
            <div className={styles.communicationsBoundary}>
              <p>{communications?.authorityNotice || "Customer-facing communications remain locked until their source and delivery evidence are available."}</p>
              <a href="/marketing?section=reviews">Open Podium Reviews</a>
            </div>
          </section>

          <section className={styles.fleetControl} aria-labelledby="opsbot-fleet-title">
            <div className={styles.controlTitle}>
              <div><span>Fleet control pack</span><strong id="opsbot-fleet-title">Vehicle availability command</strong></div>
              <small data-mode={fleet?.mode}>{fleet?.mode === "live_control" ? "Mission Control" : "Preview simulation"}</small>
            </div>
            <div className={styles.fleetSummary}>
              <div><b>{fleet?.summary.outOfService || 0}</b><span>out of service</span></div>
              <div><b>{fleet?.summary.actionRequired || 0}</b><span>need action</span></div>
              <div><b>{fleet?.summary.activeRepairs || 0}</b><span>active repairs</span></div>
              <div><b>{fleet?.summary.incompleteInspections || 0}</b><span>inspections due</span></div>
            </div>
            {fleet?.warning ? <div className={styles.dispatchWarning}>{fleet.warning}</div> : null}
            <label>
              <span>Fleet truck</span>
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
                <p>{selectedFleetTruck.topAction?.title || "No immediate Fleet queue action"}</p>
                <small>{selectedFleetTruck.topAction?.detail || `${selectedFleetTruck.activeIssueCount} active repair records`}</small>
                <small>GPS: {selectedFleetTruck.gpsFreshness} · {selectedFleetTruck.hasVerifiedCoordinate ? "verified coordinate" : "no verified coordinate"}</small>
              </article>
            ) : <div className={styles.empty}>No authoritative Fleet truck is available.</div>}

            {selectedFleetTruck?.readiness === "out_of_service" ? (
              selectedFleetTruck.blockingIssues.length === 1 ? (
                <div className={styles.fleetSensitiveAction}>
                  <div className={styles.blockingIssue}>
                    <span>Blocking repair</span>
                    <strong>{selectedFleetTruck.blockingIssues[0].title}</strong>
                    <small>{selectedFleetTruck.blockingIssues[0].status.replace("_", " ")} · {selectedFleetTruck.blockingIssues[0].owner || "No owner assigned"}</small>
                  </div>
                  <label>
                    <span>Verified repair and return-to-service resolution</span>
                    <input
                      value={fleetReturnResolution}
                      onChange={(event) => setFleetReturnResolution(event.target.value)}
                      placeholder="State the completed repair and verification"
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
                  >Request return-to-service approval</button>
                  <small>Risk class 3. Approval resolves the sole blocking repair only after a separate manager or administrator approves.</small>
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
                >Request out-of-service approval</button>
                <small>Creates a durable blocking repair. LinxUp and checklist signals never place a truck out of service automatically.</small>
              </div>
            ) : null}
            <div className={styles.fleetBoundary}>
              <p>{fleet?.mode === "live_control"
                ? "Fleet holds and returns are verified against durable repair records. No-active-hold is not a mechanical safety certification."
                : "Simulation proves policy and verification without changing shared Fleet repair or availability state."}</p>
              <a href={`/fleet?date=${encodeURIComponent(date)}&view=maintenance&section=overview`}>Open Fleet repair queue</a>
            </div>
          </section>

          <section className={styles.linxupControl} aria-labelledby="opsbot-linxup-title">
            <div className={styles.controlTitle}>
              <div><span>LinxUp control pack</span><strong id="opsbot-linxup-title">Device evidence + governed review</strong></div>
              <small data-mode={linxup?.mode}>{linxup?.mode === "live_control" ? "Mission Control" : "Preview simulation"}</small>
            </div>
            <div className={styles.linxupSummary}>
              <div data-attention={Boolean(linxup?.summary.reviewNeeded)}><b>{linxup?.summary.reviewNeeded || 0}</b><span>need review</span></div>
              <div data-attention={Boolean(linxup?.summary.missingCoordinate)}><b>{linxup?.summary.missingCoordinate || 0}</b><span>no coordinate</span></div>
              <div data-attention={Boolean(linxup?.summary.fallback)}><b>{linxup?.summary.fallback || 0}</b><span>using fallback</span></div>
              <div><b>{linxup?.summary.reviewed || 0}</b><span>current reviews</span></div>
            </div>
            {linxup?.warning ? <div className={styles.dispatchWarning}>{linxup.warning}</div> : null}
            <label>
              <span>LinxUp device</span>
              <select value={selectedLinxupTruckId} onChange={(event) => setSelectedLinxupTruckId(event.target.value)} disabled={loading || Boolean(busy)}>
                {(linxup?.devices || []).map((device) => (
                  <option key={device.truck} value={device.truck}>{device.truck} · {device.freshness} · {device.mappingStatus}</option>
                ))}
              </select>
            </label>
            {selectedLinxupDevice ? (
              <article className={styles.linxupTarget} data-freshness={selectedLinxupDevice.freshness}>
                <div><strong>{selectedLinxupDevice.truck}</strong><span>{selectedLinxupDevice.freshness}</span></div>
                <p>{selectedLinxupDevice.attentionReason}</p>
                <small>Delivery: {selectedLinxupDevice.deliveryMode.replaceAll("_", " ")} · Mapping: {selectedLinxupDevice.mappingStatus} · {selectedLinxupDevice.hasVerifiedCoordinate ? "verified coordinate" : "no verified coordinate"}</small>
                <small>Last device position: {selectedLinxupDevice.lastGpsUpdate || "Unavailable"}{selectedLinxupDevice.latestV3PositionAt ? ` · Latest V3: ${selectedLinxupDevice.latestV3PositionAt}` : ""}</small>
                {selectedLinxupDevice.review ? (
                  <div className={styles.linxupReviewReceipt}>
                    <span>{selectedLinxupDevice.review.disposition.replaceAll("_", " ")} · {selectedLinxupDevice.reviewCurrent ? "current evidence" : "prior evidence"}</span>
                    <p>{selectedLinxupDevice.review.note}</p>
                    <small>Recorded by {selectedLinxupDevice.review.updatedBy || "OpsCenter"} · {selectedLinxupDevice.review.updatedAt}</small>
                  </div>
                ) : null}
              </article>
            ) : <div className={styles.empty}>No LinxUp device evidence is available for this date.</div>}
            {selectedLinxupDevice ? (
              <div className={styles.linxupReviewAction}>
                <label>
                  <span>Review disposition</span>
                  <select value={linxupDisposition} onChange={(event) => setLinxupDisposition(event.target.value as LinxupControlDisposition)} disabled={Boolean(busy)}>
                    <option value="monitor">Continue monitoring</option>
                    <option value="provider_follow_up">Provider follow-up required</option>
                    <option value="mapping_follow_up">Physical mapping check required</option>
                    <option value="no_issue_confirmed">No issue confirmed</option>
                  </select>
                </label>
                <label>
                  <span>Verified review note</span>
                  <input value={linxupReviewNote} onChange={(event) => setLinxupReviewNote(event.target.value)} placeholder="State what was checked and the required follow-up" maxLength={1000} disabled={Boolean(busy)} />
                </label>
                <button type="button" disabled={Boolean(busy) || linxupReviewNote.trim().length < 5} onClick={() => void requestLinxupReview()}>Request device review approval</button>
                <small>Risk class 2. A different manager or administrator approves the disposition against the exact current device observation.</small>
              </div>
            ) : null}
            <div className={styles.linxupBoundary}>
              <p>{linxup?.authorityNotice || "LinxUp remains the telemetry authority; OpsCenter records only governed human review evidence."}</p>
              <a href={`/fleet?date=${encodeURIComponent(date)}&view=live`}>Open live Fleet map</a>
            </div>
          </section>

          <section className={styles.financeControl} aria-labelledby="opsbot-finance-title">
            <div className={styles.controlTitle}>
              <div><span>Finance control pack</span><strong id="opsbot-finance-title">Daily close + payment review + payroll</strong></div>
              {finance ? <small data-mode={finance.mode}>{finance.mode === "live_control" ? "Mission Control" : "Preview simulation"}</small> : null}
            </div>
            {financeAccessDenied ? (
              <div className={styles.financeAccess}>Finance evidence and money controls require a manager or administrator. Other OpsBot controls remain available.</div>
            ) : finance ? (
              <>
                <div className={styles.financeSummary}>
                  <div data-status={finance.paymentReconciliation.status}>
                    <b>{reconciliationLabel(finance.paymentReconciliation.status)}</b><span>payments</span>
                  </div>
                  <div><b>{finance.paymentReconciliation.exceptionCount}</b><span>exceptions</span></div>
                  <div><b>{moneyLabel(finance.paymentReconciliation.summary.net_difference)}</b><span>net difference</span></div>
                  <div><b>{finance.payrollCorrections.count}</b><span>payroll corrections</span></div>
                </div>
                <div className={styles.financeEvidence}>
                  <span>JunkWare {moneyLabel(finance.paymentReconciliation.summary.junkware_total)}</span>
                  <span>QBO {moneyLabel(finance.paymentReconciliation.summary.merchant_center_total)}</span>
                  <span>{finance.paymentReconciliation.currentReviewCount} current exception reviews</span>
                  <span>{finance.manualBonuses.count} bonuses · {moneyLabel(finance.manualBonuses.totalAmount)}</span>
                </div>
                {finance.paymentReconciliation.exceptions.length > 0 ? (
                  <div className={styles.paymentReviewControl}>
                    <div className={styles.paymentReviewHead}>
                      <div><strong>Payment exception follow-up</strong><small>Risk 2 · separate approver</small></div>
                      <label>
                        <span>Payment exception</span>
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
                            <span>{selectedFinanceException.reviewCurrent ? "Current review" : "Prior evidence — source changed"}</span>
                            <p>{selectedFinanceException.review.owner} · {selectedFinanceException.review.nextAction}</p>
                            <small>{selectedFinanceException.review.disposition.replaceAll("_", " ")} · {selectedFinanceException.review.updatedBy}</small>
                          </div>
                        ) : null}
                        <div className={styles.paymentReviewForm}>
                          <label>
                            <span>Disposition</span>
                            <select value={paymentReviewDisposition} onChange={(event) => {
                              const disposition = event.target.value as PaymentReviewDisposition;
                              setPaymentReviewDisposition(disposition);
                              setPaymentReviewNextStep(paymentReviewNextAction(disposition));
                            }} disabled={Boolean(busy)}>
                              <option value="keep_open">Keep exception open</option>
                              <option value="qbo_follow_up">QBO follow-up</option>
                              <option value="junkware_follow_up">JunkWare follow-up</option>
                              <option value="refund_verification">Refund verification</option>
                              <option value="no_issue_confirmed">No issue confirmed</option>
                            </select>
                          </label>
                          <label>
                            <span>Owner</span>
                            <input value={paymentReviewOwner} onChange={(event) => setPaymentReviewOwner(event.target.value)} placeholder="Accountable manager" maxLength={80} disabled={Boolean(busy)} />
                          </label>
                          <label className={styles.paymentReviewNextAction}>
                            <span>Next action</span>
                            <input value={paymentReviewNextStep} onChange={(event) => setPaymentReviewNextStep(event.target.value)} placeholder="State the source verification required" maxLength={240} disabled={Boolean(busy)} />
                          </label>
                          <label className={styles.paymentReviewEvidence}>
                            <span>Evidence note</span>
                            <input value={paymentReviewNote} onChange={(event) => setPaymentReviewNote(event.target.value)} placeholder="State what was checked; do not enter card or contact data" maxLength={1000} disabled={Boolean(busy)} />
                          </label>
                          <button
                            type="button"
                            disabled={Boolean(busy) || paymentReviewOwner.trim().length < 2 || paymentReviewNextStep.trim().length < 5 || paymentReviewNote.trim().length < 5}
                            onClick={() => void requestPaymentExceptionReview()}
                          >Request exception review approval</button>
                          <small>This records internal ownership and evidence only. It cannot clear the source exception or change QBO or JunkWare.</small>
                        </div>
                      </>
                    ) : null}
                  </div>
                ) : (
                  <div className={styles.paymentReviewEmpty}>No current payment exception requires review. Controls unlock only from refreshed source evidence.</div>
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
                      <div><strong>Manual bonus</strong><small>Risk 3 · separate approver</small></div>
                      <div className={styles.financeInputGrid}>
                        <label>
                          <span>Amount</span>
                          <input type="number" min="0.01" max="10000" step="0.01" inputMode="decimal" value={bonusAmount} onChange={(event) => setBonusAmount(event.target.value)} placeholder="$0.00" disabled={Boolean(busy)} />
                        </label>
                        <label>
                          <span>Verified reason</span>
                          <input value={bonusNote} onChange={(event) => setBonusNote(event.target.value)} placeholder="State the earned bonus evidence" maxLength={1000} disabled={Boolean(busy)} />
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
                      >Request bonus approval</button>
                    </article>
                    <article className={styles.financeAction}>
                      <div><strong>Payroll correction</strong><small>Risk 3 · separate approver</small></div>
                      <div className={styles.payrollTimeGrid}>
                        <label><span>Clock in</span><input value={payrollClockIn} onChange={(event) => setPayrollClockIn(event.target.value)} placeholder="08:00 AM" disabled={Boolean(busy)} /></label>
                        <label><span>Clock out</span><input value={payrollClockOut} onChange={(event) => setPayrollClockOut(event.target.value)} placeholder="04:30 PM" disabled={Boolean(busy)} /></label>
                        <label><span>Hourly rate</span><input type="number" min="0.01" max="500" step="0.01" inputMode="decimal" value={payrollHourlyRate} onChange={(event) => setPayrollHourlyRate(event.target.value)} placeholder="$0.00" disabled={Boolean(busy)} /></label>
                      </div>
                      <label><span>Verified correction reason</span><input value={payrollNote} onChange={(event) => setPayrollNote(event.target.value)} placeholder="State the timecard evidence" maxLength={1000} disabled={Boolean(busy)} /></label>
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
                      >Request payroll correction approval</button>
                    </article>
                  </div>
                ) : <div className={styles.empty}>No employee from the authoritative payroll inputs is available for this date.</div>}
                <div className={styles.financeBoundary}>
                  <p>{finance.authorityNotice}</p>
                  <div>
                    <a href={`/finance?date=${encodeURIComponent(date)}&view=daily&section=payments`}>Open Payments &amp; Recon</a>
                    <a href={`/crew?date=${encodeURIComponent(date)}&section=pay-period`}>Open pay period</a>
                  </div>
                </div>
              </>
            ) : <div className={styles.empty}>Loading authorized Finance evidence…</div>}
          </section>

          <div className={styles.controlTitle}>
            <div><span>Work control pack</span><strong>Owned operating work</strong></div>
          </div>
          <label>
            <span>Target work item</span>
            <select value={selectedId} onChange={(event) => setSelectedId(event.target.value)} disabled={loading || Boolean(busy)}>
              {(inbox?.items || []).map((item) => (
                <option key={item.id} value={item.id}>{item.title} · {item.status.replaceAll("_", " ")}</option>
              ))}
            </select>
          </label>

          {selected ? (
            <article className={styles.target}>
              <div><span data-severity={selected.severity}>{selected.severity}</span><small>{selected.category} · v{selected.version}</small></div>
              <strong>{selected.title}</strong>
              <p>{selected.description}</p>
              <small>Recommended: {selected.recommendedAction}</small>
            </article>
          ) : (
            <div className={styles.empty}>No reconciled work item is available for this date.</div>
          )}

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
                <span>Verified resolution reason</span>
                <input value={resolutionReason} onChange={(event) => setResolutionReason(event.target.value)} placeholder="State what was verified and where" />
              </label>
              <button
                type="button"
                disabled={Boolean(busy) || resolutionReason.trim().length < 3}
                onClick={() => void requestWorkAction("work.resolve_manually.v1", { reason: resolutionReason })}
              >
                Request resolution approval
              </button>
              <small>Sensitive because it removes work from the active queue. A different manager or administrator must approve it.</small>
            </div>
          ) : null}
        </div>

        <aside className={styles.ledger}>
          <div className={styles.ledgerHead}>
            <div><span>Action ledger</span><strong>{snapshot?.summary.total || 0} recorded</strong></div>
            <div><b>{snapshot?.summary.awaitingApproval || 0}</b> approvals</div>
            <div><b>{snapshot?.summary.succeeded || 0}</b> verified</div>
            <div><b>{snapshot?.summary.failed || 0}</b> failed</div>
          </div>
          <div className={styles.runs}>
            {recentRuns.map((run) => (
              <article key={run.id} data-status={run.status}>
                <div>
                  <strong>{actionLabel(run.actionKey)}</strong>
                  <span>{statusLabel(run.status)}</span>
                </div>
                <small>{run.verification?.summary || run.policyDecision.reasons[0]}</small>
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
            {!loading && !recentRuns.length ? <div className={styles.empty}>No action runs have been recorded yet.</div> : null}
          </div>
        </aside>
      </div>
    </section>
  );
}
