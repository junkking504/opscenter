"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { OpsAction, OpsActionOperation, OpsActionStore, OpsActionStatus } from "@/lib/ops-actions";

type ActionSummary = {
  total: number;
  active: number;
  critical: number;
  counts: Record<OpsActionStatus, number>;
};

type ActionPayload = {
  store: OpsActionStore;
  summary: ActionSummary;
};

function statusLabel(action: OpsAction): string {
  if (action.status === "acknowledged") return "Acknowledged";
  if (action.status === "snoozed") return "Snoozed";
  if (action.status === "handled") return "Handled";
  if (action.status === "resolved") return "Resolved";
  return "Open";
}

function timeLabel(value: string): string {
  if (!value) return "";
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "";
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Chicago",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

export default function OperationsActionCenter() {
  const [payload, setPayload] = useState<ActionPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [showHistory, setShowHistory] = useState(false);
  const [savingId, setSavingId] = useState("");

  const load = useCallback(async (quiet = false) => {
    if (!quiet) setLoading(true);
    try {
      const response = await fetch("/api/actions", { cache: "no-store" });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(String(body?.error || "Unable to load actions."));
      setPayload(body as ActionPayload);
      setError("");
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Unable to load actions.");
    } finally {
      if (!quiet) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    const interval = window.setInterval(() => void load(true), 60_000);
    return () => window.clearInterval(interval);
  }, [load]);

  const actions = useMemo(() => {
    const rows = payload?.store.actions || [];
    return showHistory ? rows : rows.filter((action) => !["handled", "resolved"].includes(action.status));
  }, [payload, showHistory]);

  async function transition(action: OpsAction, operation: OpsActionOperation) {
    setSavingId(action.actionId);
    setError("");
    try {
      const response = await fetch("/api/actions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ actionId: action.actionId, operation, snoozeMinutes: 60 }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(String(body?.error || "Unable to update the action."));
      setPayload(body as ActionPayload);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Unable to update the action.");
    } finally {
      setSavingId("");
    }
  }

  const summary = payload?.summary || { total: 0, active: 0, critical: 0, counts: { open: 0, acknowledged: 0, snoozed: 0, handled: 0, resolved: 0 } };

  return (
    <section className="ops-card ops-action-center" aria-labelledby="ops-action-center-title">
      <div className="ops-action-center-head">
        <div>
          <div className="ops-operating-kicker"><span /> Controlled automation</div>
          <h2 id="ops-action-center-title">Action Center</h2>
          <p>Operational alerts become owned, auditable work. Source conditions resolve only when OpsCenter verifies that they cleared.</p>
        </div>
        <div className="ops-action-center-counts" aria-label="Action counts">
          <span className={summary.critical ? "is-critical" : ""}><strong>{summary.critical}</strong> critical</span>
          <span><strong>{summary.active}</strong> active</span>
          <span><strong>{summary.counts.snoozed}</strong> snoozed</span>
        </div>
      </div>

      <div className="ops-action-center-toolbar">
        <span>{loading ? "Loading action ledger…" : `${actions.length} ${showHistory ? "total" : "active"} action${actions.length === 1 ? "" : "s"}`}</span>
        <div>
          <button type="button" onClick={() => setShowHistory((value) => !value)}>{showHistory ? "Active only" : "Show history"}</button>
          <button type="button" onClick={() => void load()} disabled={loading}>Refresh</button>
        </div>
      </div>

      {error ? <div className="ops-action-center-error" role="alert">{error}</div> : null}
      {!loading && !actions.length ? (
        <div className="ops-action-center-empty">
          <strong>{showHistory ? "No actions have been recorded yet." : "No active actions."}</strong>
          <span>New Slack-backed operational alerts will appear here automatically.</span>
        </div>
      ) : null}

      <div className="ops-action-center-list">
        {actions.slice(0, showHistory ? 20 : 10).map((action) => {
          const saving = savingId === action.actionId;
          return (
            <article className={`ops-action-center-item is-${action.severity} status-${action.status}`} key={action.actionId}>
              <div className="ops-action-center-item-main">
                <div className="ops-action-center-item-meta">
                  <span className={`ops-action-center-status status-${action.status}`}>{statusLabel(action)}</span>
                  <span>{action.kind.replace(/_/g, " ")}</span>
                  <span>{timeLabel(action.updatedAt)}</span>
                </div>
                <h3>{action.title}</h3>
                <p>{action.detail}</p>
                <small><strong>Next:</strong> {action.nextAction}</small>
                {action.ownerLabel ? <small><strong>Owner:</strong> {action.ownerLabel}</small> : null}
                {action.status === "snoozed" && action.snoozedUntil ? <small><strong>Returns:</strong> {timeLabel(action.snoozedUntil)}</small> : null}
              </div>
              <div className="ops-action-center-item-actions">
                {action.status === "open" ? <button type="button" disabled={saving} onClick={() => void transition(action, "acknowledge")}>Acknowledge</button> : null}
                {["open", "acknowledged"].includes(action.status) ? <button type="button" disabled={saving} onClick={() => void transition(action, "snooze")}>Snooze 1h</button> : null}
                {["open", "acknowledged", "snoozed"].includes(action.status) ? <button type="button" disabled={saving} onClick={() => void transition(action, "handle")}>Mark handled</button> : null}
                {action.status === "handled" && action.sourceActive ? <button type="button" disabled={saving} onClick={() => void transition(action, "reopen")}>Reopen</button> : null}
                <a href={action.href}>Open source</a>
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}
