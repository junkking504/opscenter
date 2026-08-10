"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import type { WorkItemStatus } from "@/lib/platform/contracts";
import type { InboxEvent, InboxPayload, InboxWorkItem } from "@/lib/platform/inbox";
import styles from "./OperatingInbox.module.css";

type ScopeFilter = "all" | "mine" | "unassigned";
type LifecycleFilter = "open" | "snoozed" | "resolved";

function formatAge(value: string): string {
  const ms = Date.now() - new Date(value).getTime();
  if (!Number.isFinite(ms)) return "Unknown age";
  const minutes = Math.max(0, Math.floor(ms / 60_000));
  if (minutes < 60) return `${minutes}m old`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h old`;
  return `${Math.floor(hours / 24)}d old`;
}

function formatTime(value?: string): string {
  if (!value) return "Not set";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "Unavailable";
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Chicago",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(parsed);
}

function statusLabel(status: WorkItemStatus): string {
  return status.replaceAll("_", " ");
}

function eventLabel(eventType: string): string {
  const labels: Record<string, string> = {
    "work.detected.v1": "Condition detected",
    "work.reopened.v1": "Condition detected again",
    "work.acknowledged.v1": "Acknowledged",
    "work.assigned.v1": "Ownership changed",
    "work.snoozed.v1": "Snoozed",
    "work.dismissed.v1": "Dismissed",
    "work.resolved_manually.v1": "Resolved manually",
    "work.resolved.v1": "Verified clear from source",
    "work.reopen.v1": "Reopened",
  };
  return labels[eventType] || eventType;
}

async function responseJson<T>(response: Response): Promise<T> {
  const payload = await response.json().catch(() => ({})) as T & { error?: string };
  if (!response.ok) throw new Error(payload.error || `Request failed (${response.status})`);
  return payload;
}

export default function OperatingInbox({
  date,
  variant = "standalone",
}: {
  date: string;
  variant?: "standalone" | "command";
}) {
  const [payload, setPayload] = useState<InboxPayload | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [events, setEvents] = useState<InboxEvent[]>([]);
  const [scope, setScope] = useState<ScopeFilter>("all");
  const [lifecycle, setLifecycle] = useState<LifecycleFilter>("open");
  const [severity, setSeverity] = useState("all");
  const [category, setCategory] = useState("all");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await responseJson<InboxPayload>(await fetch("/api/inbox/reconcile", {
        method: "POST",
        cache: "no-store",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ date }),
      }));
      setPayload(result);
      setSelectedId((current) => current && result.items.some((item) => item.id === current)
        ? current
        : result.items[0]?.id || null);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Unable to load the Operating Inbox.");
    } finally {
      setLoading(false);
    }
  }, [date]);

  useEffect(() => { void load(); }, [load]);

  const visibleItems = useMemo(() => {
    if (!payload) return [];
    return payload.items.filter((item) => {
      if (scope === "mine" && item.ownerActorId !== payload.actor.id) return false;
      if (scope === "unassigned" && item.ownerActorId) return false;
      if (lifecycle === "open" && !["open", "acknowledged", "in_progress"].includes(item.status)) return false;
      if (lifecycle === "snoozed" && item.status !== "snoozed") return false;
      if (lifecycle === "resolved" && !["resolved", "dismissed"].includes(item.status)) return false;
      if (severity !== "all" && item.severity !== severity) return false;
      if (category !== "all" && item.category !== category) return false;
      return true;
    });
  }, [payload, scope, lifecycle, severity, category]);

  useEffect(() => {
    if (selectedId && !visibleItems.some((item) => item.id === selectedId)) {
      setSelectedId(visibleItems[0]?.id || null);
    }
  }, [selectedId, visibleItems]);

  const selected = payload?.items.find((item) => item.id === selectedId) || null;

  useEffect(() => {
    if (!selectedId) {
      setEvents([]);
      return;
    }
    const controller = new AbortController();
    fetch(`/api/inbox/${encodeURIComponent(selectedId)}`, { cache: "no-store", signal: controller.signal })
      .then((response) => responseJson<{ events: InboxEvent[] }>(response))
      .then((detail) => setEvents(detail.events))
      .catch((historyError: Error) => {
        if (historyError.name !== "AbortError") setError(historyError.message);
      });
    return () => controller.abort();
  }, [selectedId]);

  async function runAction(item: InboxWorkItem, action: string, extra: Record<string, unknown> = {}) {
    setBusy(true);
    setError(null);
    try {
      const result = await responseJson<{ item: InboxWorkItem; events: InboxEvent[] }>(await fetch(
        `/api/inbox/${encodeURIComponent(item.id)}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action, expectedVersion: item.version, ...extra }),
        },
      ));
      setPayload((current) => current ? {
        ...current,
        items: current.items.map((candidate) => candidate.id === item.id
          ? { ...candidate, ...result.item, ownerDisplayName: action === "assign_self" ? current.actor.displayName : action === "unassign" ? undefined : candidate.ownerDisplayName }
          : candidate),
      } : current);
      setEvents(result.events);
      const refreshed = await responseJson<InboxPayload>(await fetch(`/api/inbox?date=${encodeURIComponent(date)}`, { cache: "no-store" }));
      setPayload(refreshed);
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : "The action failed.");
    } finally {
      setBusy(false);
    }
  }

  function askReason(label: string): string | null {
    const value = window.prompt(`${label}. Add the reason that should appear in the audit history:`);
    return value && value.trim().length >= 3 ? value.trim() : null;
  }

  if (loading && !payload) return <div className={styles.loading}>Reconciling current operating signals…</div>;
  if (error && !payload) {
    return (
      <div className={styles.error}>
        <div><strong>Operating Inbox is not connected</strong>{error}<br />The rest of OpsCenter remains available.</div>
      </div>
    );
  }
  if (!payload) return null;

  return (
    <div className={`${styles.shell}${variant === "command" ? ` ${styles.command}` : ""}`} id={variant === "command" ? "operating-inbox" : undefined}>
      {variant === "command" ? (
        <div className={styles.commandHead}>
          <div>
            <div className={styles.kicker}><span /> Operating Inbox</div>
            <h2>Work requiring a decision</h2>
            <p>Signals become assigned work, controlled actions, and auditable outcomes.</p>
          </div>
          <Link className={styles.focusLink} href={`/inbox?date=${encodeURIComponent(date)}`}>Open focused view →</Link>
        </div>
      ) : null}
      <div className={styles.metrics}>
        <div className={styles.metric}><span>Active work</span><strong>{payload.counts.active}</strong></div>
        <div className={styles.metric}><span>Assigned to me</span><strong>{payload.counts.mine}</strong></div>
        <div className={styles.metric}><span>Unassigned</span><strong>{payload.counts.unassigned}</strong></div>
        <div className={styles.metric}><span>Resolved work</span><strong>{payload.counts.resolved}</strong></div>
      </div>

      <div className={styles.toolbar}>
        <div className={styles.scope} aria-label="Ownership filter">
          {(["all", "mine", "unassigned"] as ScopeFilter[]).map((value) => (
            <button key={value} type="button" className={scope === value ? styles.active : ""} onClick={() => setScope(value)}>
              {value === "all" ? "All work" : value === "mine" ? "Mine" : "Unassigned"}
            </button>
          ))}
        </div>
        <div className={styles.filters}>
          <select className={styles.filter} value={lifecycle} onChange={(event) => setLifecycle(event.target.value as LifecycleFilter)} aria-label="Work status">
            <option value="open">Open</option><option value="snoozed">Snoozed</option><option value="resolved">Resolved</option>
          </select>
          <select className={styles.filter} value={severity} onChange={(event) => setSeverity(event.target.value)} aria-label="Severity">
            <option value="all">All severity</option><option value="critical">Critical</option><option value="warning">Warning</option><option value="info">Info</option>
          </select>
          <select className={styles.filter} value={category} onChange={(event) => setCategory(event.target.value)} aria-label="Category">
            <option value="all">All categories</option><option value="Jobs">Jobs</option><option value="Crew">Crew</option><option value="Fleet">Fleet</option><option value="Finance">Finance</option>
          </select>
          <button className={styles.refresh} type="button" onClick={() => void load()} disabled={loading || busy}>{loading ? "Refreshing…" : "Refresh signals"}</button>
        </div>
      </div>

      {error ? <div className={styles.error}><div><strong>Action needs attention</strong>{error}</div></div> : null}

      <section className={styles.workspace} aria-label="Operating Inbox">
        <div className={styles.list}>
          <div className={styles.listHead}><span>Work queue</span><span>{visibleItems.length} shown</span></div>
          <div className={styles.items}>
            {visibleItems.length ? visibleItems.map((item) => (
              <button
                type="button"
                key={item.id}
                className={`${styles.item}${selectedId === item.id ? ` ${styles.selected}` : ""}`}
                data-severity={item.severity}
                onClick={() => setSelectedId(item.id)}
              >
                <div className={styles.itemTop}>
                  <div><div className={styles.itemTitle}>{item.title}</div><div className={styles.entity}>{item.entity.label || item.entity.id}</div></div>
                  <span className={styles.pill}>{item.severity}</span>
                </div>
                <div className={styles.itemMeta}>
                  <span>{item.ownerDisplayName || "Unassigned"}</span>
                  <span>{statusLabel(item.status)} · {formatAge(item.firstDetectedAt)}</span>
                </div>
              </button>
            )) : <div className={styles.empty}>No work matches these filters.</div>}
          </div>
        </div>

        <div className={styles.detail}>
          {selected ? (
            <>
              <div className={styles.detailTop}>
                <div><h2>{selected.title}</h2><div className={styles.entity}>{selected.entity.label || selected.entity.id}</div></div>
                <span className={styles.pill}>{statusLabel(selected.status)}</span>
              </div>
              <p className={styles.reason}>{selected.description}</p>
              <div className={styles.facts}>
                <div className={styles.fact}><span>Owner</span><strong>{selected.ownerDisplayName || "Unassigned"}</strong></div>
                <div className={styles.fact}><span>Category</span><strong>{selected.category} · {selected.severity}</strong></div>
                <div className={styles.fact}><span>First detected</span><strong>{formatTime(selected.firstDetectedAt)}</strong></div>
                <div className={styles.fact}><span>Source observed</span><strong>{formatTime(selected.sourceObservedAt)}</strong></div>
                <div className={styles.fact}><span>Rule</span><strong>{selected.rule}</strong></div>
                <div className={styles.fact}><span>Source</span><strong>{selected.source}</strong></div>
              </div>
              <div className={styles.actions}>
                {selected.href ? <Link className={styles.recordLink} href={selected.href}>Open related record →</Link> : null}
                {!selected.ownerActorId ? <button className={`${styles.action} ${styles.primary}`} disabled={busy} onClick={() => void runAction(selected, "assign_self")}>Claim</button> : null}
                {selected.ownerActorId ? <button className={styles.action} disabled={busy} onClick={() => void runAction(selected, "unassign")}>Unassign</button> : null}
                {selected.status === "open" ? <button className={styles.action} disabled={busy} onClick={() => void runAction(selected, "acknowledge")}>Acknowledge</button> : null}
                {!["resolved", "dismissed"].includes(selected.status) ? (
                  <button className={styles.action} disabled={busy} onClick={() => void runAction(selected, "snooze", { until: new Date(Date.now() + 2 * 60 * 60_000).toISOString() })}>Snooze 2h</button>
                ) : null}
                {!["resolved", "dismissed"].includes(selected.status) ? (
                  <button className={styles.action} disabled={busy} onClick={() => { const reason = askReason("Resolve manually"); if (reason) void runAction(selected, "resolve_manually", { reason }); }}>Resolve</button>
                ) : <button className={styles.action} disabled={busy} onClick={() => void runAction(selected, "reopen")}>Reopen</button>}
                {!["resolved", "dismissed"].includes(selected.status) ? (
                  <button className={`${styles.action} ${styles.danger}`} disabled={busy} onClick={() => { const reason = askReason("Dismiss this condition"); if (reason) void runAction(selected, "dismiss", { reason }); }}>Dismiss</button>
                ) : null}
              </div>
              <div className={styles.timeline}>
                <div className={styles.timelineHead}><strong>Audit history</strong><span className={styles.entity}>{events.length} events</span></div>
                {events.length ? events.map((event) => (
                  <div className={styles.event} key={event.id}>
                    <div>
                      <strong>{eventLabel(event.eventType)}</strong>
                      <time>{formatTime(event.occurredAt)} · {event.actorDisplayName || "System"}</time>
                    </div>
                  </div>
                )) : <div className={styles.entity}>Loading history…</div>}
              </div>
            </>
          ) : <div className={styles.empty}>Select a work item to see context, controls, and audit history.</div>}
        </div>
      </section>
    </div>
  );
}
