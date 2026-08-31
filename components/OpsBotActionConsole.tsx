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
  };
  return labels[actionKey] || actionKey;
}

function activeItem(item: InboxWorkItem): boolean {
  return !["resolved", "dismissed"].includes(item.status);
}

export default function OpsBotActionConsole({ date, enabled }: { date: string; enabled: boolean }) {
  const [inbox, setInbox] = useState<InboxPayload | null>(null);
  const [snapshot, setSnapshot] = useState<ActionSnapshot | null>(null);
  const [dispatch, setDispatch] = useState<DispatchSnapshot | null>(null);
  const [selectedId, setSelectedId] = useState("");
  const [selectedAppointmentId, setSelectedAppointmentId] = useState("");
  const [dispatchTruck, setDispatchTruck] = useState("");
  const [resolutionReason, setResolutionReason] = useState("");
  const [loading, setLoading] = useState(enabled);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    if (!enabled) return;
    setLoading(true);
    setError("");
    try {
      const [inboxPayload, actionPayload, dispatchPayload] = await Promise.all([
        responseJson<InboxPayload>(await fetch("/api/inbox/reconcile", {
          method: "POST",
          cache: "no-store",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ date }),
        })),
        responseJson<ActionSnapshot>(await fetch("/api/platform/action-runs", { cache: "no-store" })),
        responseJson<DispatchSnapshot>(await fetch(`/api/platform/dispatch?date=${encodeURIComponent(date)}`, { cache: "no-store" })),
      ]);
      setInbox(inboxPayload);
      setSnapshot(actionPayload);
      setDispatch(dispatchPayload);
      setSelectedId((current) => current && inboxPayload.items.some((item) => item.id === current)
        ? current
        : inboxPayload.items.find(activeItem)?.id || inboxPayload.items[0]?.id || "");
      setSelectedAppointmentId((current) => current && dispatchPayload.appointments.some((item) => item.appointmentId === current)
        ? current
        : dispatchPayload.appointments[0]?.appointmentId || "");
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
  useEffect(() => {
    setDispatchTruck(selectedAppointment?.effectiveTruck || "");
  }, [selectedAppointment]);
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
      await load();
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "The dispatch action request failed.");
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
              </div>
            ) : null}
            <p className={styles.dispatchBoundary}>
              {dispatch?.mode === "live_control"
                ? "Truck changes require a different manager or administrator, then JunkWare read-back verification."
                : "Simulation proves policy and verification without changing shared Dispatch state or JunkWare."}
            </p>
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
