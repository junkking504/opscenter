"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { CommandBriefException } from "@/components/CommandBrief";
import type { ActionRun } from "@/lib/platform/contracts";
import type { InboxPayload } from "@/lib/platform/inbox";
import styles from "./OpsBotCommandBrief.module.css";

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

const actionLabels: Record<string, string> = {
  "work.resolve_manually.v1": "Close follow-up item",
  "jobs.update_closeout.v1": "Fix completed job",
  "dispatch.assign_truck.v1": "Change appointment truck",
  "dispatch.reschedule_time.v1": "Change appointment time",
  "dispatch.cancel_appointment.v1": "Cancel appointment",
  "dispatch.move_date.v1": "Move appointment date",
  "fleet.mark_out_of_service.v1": "Take truck out of service",
  "fleet.return_to_service.v1": "Return truck to service",
  "finance.record_manual_bonus.v1": "Add manual bonus",
  "finance.record_payroll_correction.v1": "Correct payroll",
  "finance.record_payment_exception_review.v1": "Save payment follow-up",
  "krewe.schedule_call_in.v1": "Schedule Krewe call-in",
  "communications.post_ops_command_notice.v1": "Post team update",
  "communications.approve_customer_contact.v1": "Prepare customer follow-up",
  "marketing.assign_podium_review.v1": "Match review to completed job",
  "marketing.record_searchkings_recovery.v1": "Save missed-lead follow-up",
  "systems.record_integration_review.v1": "Save system follow-up",
  "linxup.record_device_review.v1": "Save GPS follow-up",
};

function actionLabel(run: ActionRun): string {
  return actionLabels[run.actionKey] || run.entity.label || "OpsCenter change";
}

function actionHref(run: ActionRun, date: string): string {
  if (run.entity.type === "job" || run.entity.type === "customer") return `/jobs?date=${encodeURIComponent(date)}`;
  if (run.entity.type === "truck") return `/fleet?date=${encodeURIComponent(date)}`;
  if (run.entity.type === "employee") return `/crew?date=${encodeURIComponent(date)}`;
  if (run.entity.type === "finance") return `/finance?date=${encodeURIComponent(date)}`;
  if (run.entity.type === "review" || run.entity.type === "lead") return `/marketing?date=${encodeURIComponent(date)}`;
  return `/?date=${encodeURIComponent(date)}#operating-inbox`;
}

function resultLabel(run: ActionRun): string {
  if (run.status === "succeeded") return "Done";
  if (run.status === "denied") return "Denied";
  return "Needs another look";
}

async function responseJson<T>(response: Response): Promise<T> {
  const payload = await response.json().catch(() => ({})) as T & { error?: string };
  if (!response.ok) throw new Error(payload.error || "OpsBot could not load the latest activity.");
  return payload;
}

export default function OpsBotCommandBrief({
  date,
  exceptions,
}: {
  date: string;
  exceptions: CommandBriefException[];
}) {
  const [snapshot, setSnapshot] = useState<ActionSnapshot | null>(null);
  const [actorId, setActorId] = useState("");
  const [busyRunId, setBusyRunId] = useState("");
  const [loadFailed, setLoadFailed] = useState(false);
  const [decisionError, setDecisionError] = useState("");

  const load = useCallback(async () => {
    try {
      const [actions, inbox] = await Promise.all([
        responseJson<ActionSnapshot>(await fetch("/api/platform/action-runs", { cache: "no-store" })),
        responseJson<InboxPayload>(await fetch(`/api/inbox?date=${encodeURIComponent(date)}`, { cache: "no-store" })),
      ]);
      setSnapshot(actions);
      setActorId(inbox.actor.id);
      setLoadFailed(false);
    } catch {
      setLoadFailed(true);
    }
  }, [date]);

  useEffect(() => { void load(); }, [load]);

  const waiting = useMemo(
    () => (snapshot?.runs || []).filter((run) => run.status === "awaiting_approval").slice(0, 3),
    [snapshot],
  );
  const recentResults = useMemo(
    () => (snapshot?.runs || []).filter((run) => ["succeeded", "failed", "denied"].includes(run.status)).slice(0, 3),
    [snapshot],
  );
  const hasProblemResult = recentResults.some((run) => run.status === "failed");
  const hasUsefulWork = exceptions.length > 0 || waiting.length > 0 || hasProblemResult;

  async function decide(run: ActionRun, decision: "approved" | "denied") {
    setBusyRunId(run.id);
    setDecisionError("");
    try {
      await responseJson(await fetch(`/api/platform/action-runs/${encodeURIComponent(run.id)}/approve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          decision,
          reason: decision === "approved" ? "Approved in Command." : "Denied in Command.",
        }),
      }));
      await load();
    } catch {
      setDecisionError("OpsCenter could not save that decision. Refresh and try again.");
    } finally {
      setBusyRunId("");
    }
  }

  if (!hasUsefulWork) return null;

  const waitingCount = snapshot?.summary.awaitingApproval || waiting.length;
  const headline = waitingCount > 0
    ? `${waitingCount} approval${waitingCount === 1 ? " is" : "s are"} waiting`
    : `${exceptions.length} item${exceptions.length === 1 ? " needs" : "s need"} attention`;

  return (
    <section className={styles.shell} id="opsbot-assistant" aria-labelledby="opsbot-command-brief-title">
      <header className={styles.header}>
        <div className={styles.identity}>
          <span className={styles.mark} aria-hidden="true">OB</span>
          <div>
            <span>OpsBot</span>
            <h2 id="opsbot-command-brief-title">{headline}</h2>
          </div>
        </div>
        <small>Only appears when something needs attention.</small>
      </header>

      {decisionError ? <p className={styles.error} role="alert">{decisionError}</p> : null}

      <div className={styles.columns}>
        <section className={styles.column} aria-labelledby="opsbot-needs-attention">
          <div className={styles.columnHead}>
            <h3 id="opsbot-needs-attention">Needs attention</h3>
            <span>{exceptions.length}</span>
          </div>
          <div className={styles.items}>
            {exceptions.length ? exceptions.slice(0, 3).map((item) => (
              <Link className={styles.attentionItem} href={item.href} key={`${item.label}-${item.detail}`}>
                <i data-status={item.status} aria-hidden="true" />
                <span><strong>{item.label}</strong><small>{item.detail}</small></span>
                <b aria-hidden="true">→</b>
              </Link>
            )) : <p className={styles.empty}>Nothing urgent right now.</p>}
          </div>
        </section>

        <section className={styles.column} aria-labelledby="opsbot-waiting-approval">
          <div className={styles.columnHead}>
            <h3 id="opsbot-waiting-approval">Waiting for approval</h3>
            <span>{waitingCount}</span>
          </div>
          <div className={styles.items}>
            {waiting.length ? waiting.map((run) => {
              const needsDifferentManager = run.riskClass >= 2 && run.actorId === actorId;
              return (
                <article className={styles.approvalItem} key={run.id}>
                  <div>
                    <strong>{actionLabel(run)}</strong>
                    <small>{run.entity.label || run.entity.id}</small>
                  </div>
                  <div className={styles.approvalActions}>
                    <Link href={actionHref(run, date)}>Open</Link>
                    {needsDifferentManager ? <span>Another manager must review</span> : (
                      <>
                        <button type="button" disabled={busyRunId === run.id} onClick={() => void decide(run, "approved")}>Approve</button>
                        <button type="button" disabled={busyRunId === run.id} onClick={() => void decide(run, "denied")}>Deny</button>
                      </>
                    )}
                  </div>
                </article>
              );
            }) : <p className={styles.empty}>{loadFailed ? "Approval status is unavailable." : "No approvals are waiting."}</p>}
          </div>
        </section>

        <section className={styles.column} aria-labelledby="opsbot-recent-results">
          <div className={styles.columnHead}>
            <h3 id="opsbot-recent-results">Recent results</h3>
            <span>{recentResults.length}</span>
          </div>
          <div className={styles.items}>
            {recentResults.length ? recentResults.map((run) => (
              <Link className={styles.resultItem} data-status={run.status} href={actionHref(run, date)} key={run.id}>
                <span><strong>{actionLabel(run)}</strong><small>{run.entity.label || run.entity.id}</small></span>
                <b>{resultLabel(run)}</b>
              </Link>
            )) : <p className={styles.empty}>No recent results.</p>}
          </div>
        </section>
      </div>
    </section>
  );
}
