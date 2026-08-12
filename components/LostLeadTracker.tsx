"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { appointmentScheduleHref } from "@/lib/job-links";
import { groupSearchKingsLeadsByDate } from "@/lib/searchkings-date-groups";
import { searchKingsPhoneHref } from "@/lib/searchkings-phone";
import type {
  LostLeadReason,
  LostLeadStatus,
  SearchKingsLead,
} from "@/lib/searchkings";

const STATUS_OPTIONS: Array<{ value: LostLeadStatus; label: string }> = [
  { value: "needs_follow_up", label: "Needs follow-up" },
  { value: "booked", label: "Booked" },
  { value: "lost", label: "Lost" },
  { value: "recovered", label: "Recovered" },
  { value: "unqualified", label: "Unqualified" },
];

const REASON_OPTIONS: Array<{ value: LostLeadReason; label: string }> = [
  { value: "", label: "No reason selected" },
  { value: "availability", label: "Availability" },
  { value: "pricing", label: "Pricing" },
  { value: "missed_call", label: "Missed call" },
  { value: "no_follow_up", label: "No follow-up" },
  { value: "competitor", label: "Went with competitor" },
  { value: "out_of_area", label: "Out of area" },
  { value: "service_not_offered", label: "Service not offered" },
  { value: "customer_declined", label: "Customer declined" },
  { value: "other", label: "Other" },
];

type Draft = {
  status: LostLeadStatus;
  reason: LostLeadReason;
  note: string;
  franchiseContacted: boolean;
};

function leadDate(value: string): string {
  if (!value) return "Unknown date";
  return new Date(value).toLocaleString("en-US", {
    timeZone: "America/Chicago",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function dollars(value: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(value || 0);
}

export default function LostLeadTracker({ leads }: { leads: SearchKingsLead[] }) {
  const actionable = useMemo(
    () => leads.filter((lead) => lead.qualified || lead.status !== "unqualified"),
    [leads],
  );
  const dateGroups = useMemo(() => groupSearchKingsLeadsByDate(actionable), [actionable]);
  const [drafts, setDrafts] = useState<Record<string, Draft>>(() =>
    Object.fromEntries(actionable.map((lead) => [lead.callId, {
      status: lead.status,
      reason: lead.reason,
      note: lead.note,
      franchiseContacted: lead.franchiseContacted,
    }])),
  );
  const [saving, setSaving] = useState("");
  const [message, setMessage] = useState<Record<string, string>>({});

  function update(callId: string, next: Partial<Draft>) {
    setDrafts((current) => ({
      ...current,
      [callId]: { ...current[callId], ...next },
    }));
  }

  async function save(callId: string) {
    const draft = drafts[callId];
    if (!draft) return;
    setSaving(callId);
    setMessage((current) => ({ ...current, [callId]: "" }));
    try {
      const response = await fetch("/api/searchkings/lost-leads", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ callId, ...draft }),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) throw new Error(String(payload?.error || "Unable to save the lead."));
      setMessage((current) => ({ ...current, [callId]: "Saved" }));
    } catch (error) {
      setMessage((current) => ({
        ...current,
        [callId]: error instanceof Error ? error.message : "Unable to save the lead.",
      }));
    } finally {
      setSaving("");
    }
  }

  if (!actionable.length) {
    return <div className="ops-card ops-alert-card"><div className="ops-muted">No qualified calls are waiting for review.</div></div>;
  }

  return (
    <div className="ops-marketing-lead-list">
      {dateGroups.map((group) => (
        <section className="ops-marketing-date-group" key={group.dateKey}>
          <div className="ops-marketing-date-heading">
            <h2>{group.label}</h2>
            <span>{group.leads.length} {group.leads.length === 1 ? "lead" : "leads"}</span>
          </div>
          <div className="ops-marketing-date-items">
            {group.leads.map((lead) => {
              const draft = drafts[lead.callId];
              return (
                <article className="ops-card ops-marketing-lead" key={lead.callId}>
            <div className="ops-marketing-lead-heading">
              <div>
                <div className="ops-marketing-lead-name">
                  <strong>{lead.callerName}</strong>
                  <span className={`ops-lead-status is-${draft.status}`}>{STATUS_OPTIONS.find((item) => item.value === draft.status)?.label}</span>
                </div>
                <div className="ops-muted">{leadDate(lead.calledAt)} · {lead.territory}</div>
              </div>
              <div className="ops-marketing-lead-value">
                <small>Potential Value</small>
                <strong>{lead.potentialRevenue == null ? "Unknown" : dollars(lead.potentialRevenue)}</strong>
              </div>
            </div>

            <div className="ops-marketing-lead-context">
              <div>
                <span>Phone</span>
                {searchKingsPhoneHref(lead.phone) ? <a className="ops-marketing-phone" href={searchKingsPhoneHref(lead.phone)}>{lead.phone}</a> : <strong>Unavailable</strong>}
              </div>
              <div><span>Score</span><strong>{lead.score ?? "—"}/5</strong></div>
              <div><span>Source</span><strong>{lead.trackingLabel || lead.source || "SearchKings"}</strong></div>
              <div>
                <span>Matched job</span>
                {lead.matchedAppointment ? (
                  <Link
                    className="ops-mini-link"
                    href={appointmentScheduleHref(
                      lead.matchedAppointment.date,
                      lead.matchedAppointment.jobId || lead.matchedAppointment.appointmentId,
                    )}
                    title={`Open ${lead.matchedAppointment.jobId || "matched job"} on the schedule`}
                  >
                    <strong>{lead.matchedAppointment.jobId || "Matched"}</strong>
                  </Link>
                ) : <strong>Not found</strong>}
              </div>
            </div>
            {lead.summary ? <p className="ops-marketing-call-summary">{lead.summary}</p> : null}
            {lead.tags.length ? <div className="ops-marketing-tags">{lead.tags.map((tag) => <span key={tag}>{tag}</span>)}</div> : null}

            <div className="ops-marketing-lead-form">
              <label className={`ops-franchise-contact ${draft.franchiseContacted ? "is-contacted" : ""}`}>
                <input
                  type="checkbox"
                  checked={draft.franchiseContacted}
                  onChange={(event) => update(lead.callId, { franchiseContacted: event.target.checked })}
                />
                <span>{draft.franchiseContacted ? "Franchise contacted" : "Franchise not contacted"}</span>
                <small>Separate from call center</small>
              </label>
              <label>Status<select value={draft.status} onChange={(event) => update(lead.callId, { status: event.target.value as LostLeadStatus })}>{STATUS_OPTIONS.map((item) => <option value={item.value} key={item.value}>{item.label}</option>)}</select></label>
              <label>Reason<select value={draft.reason} onChange={(event) => update(lead.callId, { reason: event.target.value as LostLeadReason })}>{REASON_OPTIONS.map((item) => <option value={item.value} key={item.value}>{item.label}</option>)}</select></label>
              <label className="ops-marketing-note">Follow-up note<input value={draft.note} maxLength={1000} placeholder="What happened, and what is the next action?" onChange={(event) => update(lead.callId, { note: event.target.value })} /></label>
              <button className="ops-refresh-button" type="button" disabled={saving === lead.callId} onClick={() => save(lead.callId)}>{saving === lead.callId ? "Saving…" : "Save"}</button>
            </div>
            <div className="ops-marketing-lead-footer">
              <a className="ops-mini-link" href={lead.searchKingsUrl} target="_blank" rel="noreferrer">Open in SearchKings</a>
              {message[lead.callId] ? <span className={message[lead.callId] === "Saved" ? "ops-kpi-good" : "ops-kpi-danger"}>{message[lead.callId]}</span> : null}
            </div>
                </article>
              );
            })}
          </div>
        </section>
      ))}
    </div>
  );
}
