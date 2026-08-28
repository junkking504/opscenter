"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { appointmentScheduleHref } from "@/lib/job-links";
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

type RecoveryFilter = "all" | "lost" | "needs_follow_up";

const LEADS_PER_SECTION = 25;

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

function recoveryPriority(
  left: SearchKingsLead,
  right: SearchKingsLead,
): number {
  const statusDifference =
    Number(left.status === "lost") - Number(right.status === "lost");
  if (statusDifference) return -statusDifference;
  const contactDifference =
    Number(left.franchiseContacted) - Number(right.franchiseContacted);
  if (contactDifference) return contactDifference;
  const valueDifference =
    (right.potentialRevenue ?? -1) - (left.potentialRevenue ?? -1);
  if (valueDifference) return valueDifference;
  return right.calledAt.localeCompare(left.calledAt);
}

function matchesRecoverySearch(lead: SearchKingsLead, query: string): boolean {
  if (!query) return true;
  const haystack = [
    lead.callerName,
    lead.phone,
    lead.territory,
    lead.city,
    lead.source,
    lead.trackingLabel,
    lead.summary,
    lead.note,
    lead.reason,
    ...lead.tags,
  ]
    .join(" ")
    .toLowerCase();
  return haystack.includes(query);
}

export default function LostLeadTracker({
  leads,
}: {
  leads: SearchKingsLead[];
}) {
  const router = useRouter();
  const actionable = useMemo(
    () =>
      leads
        .filter(
          (lead) => lead.status === "lost" || lead.status === "needs_follow_up",
        )
        .sort(recoveryPriority),
    [leads],
  );
  const recoveryGroups = useMemo(
    () =>
      [
        {
          id: "lost",
          title: "Lost leads",
          description:
            "No JunkWare match after the recovery window, or marked lost by a manager.",
          leads: actionable.filter((lead) => lead.status === "lost"),
        },
        {
          id: "follow-up",
          title: "Needs follow-up",
          description:
            "Qualified SearchKings calls that still need a disposition.",
          leads: actionable.filter((lead) => lead.status === "needs_follow_up"),
        },
      ].filter((group) => group.leads.length > 0),
    [actionable],
  );
  const [drafts, setDrafts] = useState<Record<string, Draft>>(() =>
    Object.fromEntries(
      actionable.map((lead) => [
        lead.callId,
        {
          status: lead.status,
          reason: lead.reason,
          note: lead.note,
          franchiseContacted: lead.franchiseContacted,
        },
      ]),
    ),
  );
  const [saving, setSaving] = useState("");
  const [message, setMessage] = useState<Record<string, string>>({});
  const [expandedLeadId, setExpandedLeadId] = useState("");
  const [filter, setFilter] = useState<RecoveryFilter>("all");
  const [query, setQuery] = useState("");
  const [visibleCounts, setVisibleCounts] = useState<Record<string, number>>({
    lost: LEADS_PER_SECTION,
    "follow-up": LEADS_PER_SECTION,
  });
  const normalizedQuery = query.trim().toLowerCase();
  const filteredLeads = useMemo(
    () =>
      actionable.filter(
        (lead) =>
          (filter === "all" || lead.status === filter) &&
          matchesRecoverySearch(lead, normalizedQuery),
      ),
    [actionable, filter, normalizedQuery],
  );
  const filteredRecoveryGroups = useMemo(
    () =>
      recoveryGroups
        .map((group) => ({
          ...group,
          leads: group.leads.filter((lead) =>
            filteredLeads.some((item) => item.callId === lead.callId),
          ),
        }))
        .filter((group) => group.leads.length > 0),
    [filteredLeads, recoveryGroups],
  );

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
      if (!response.ok)
        throw new Error(String(payload?.error || "Unable to save the lead."));
      setMessage((current) => ({ ...current, [callId]: "Saved" }));
      router.refresh();
    } catch (error) {
      setMessage((current) => ({
        ...current,
        [callId]:
          error instanceof Error ? error.message : "Unable to save the lead.",
      }));
    } finally {
      setSaving("");
    }
  }

  if (!actionable.length) {
    return (
      <div className="ops-card ops-alert-card">
        <div className="ops-muted">
          No SearchKings leads currently need recovery work.
        </div>
      </div>
    );
  }

  return (
    <div className="ops-marketing-lead-list">
      <div className="ops-card ops-marketing-recovery-toolbar">
        <label>
          <span>Find a recovery lead</span>
          <input
            type="search"
            value={query}
            placeholder="Name, phone, territory, objection, or note"
            onChange={(event) => setQuery(event.target.value)}
          />
        </label>
        <div
          className="ops-marketing-recovery-filters"
          aria-label="Recovery lead status"
        >
          {(
            [
              ["all", "All active"],
              ["lost", "Lost leads"],
              ["needs_follow_up", "Needs follow-up"],
            ] as Array<[RecoveryFilter, string]>
          ).map(([value, label]) => (
            <button
              className={`ops-button${filter === value ? " is-active" : ""}`}
              type="button"
              key={value}
              aria-pressed={filter === value}
              onClick={() => setFilter(value)}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="ops-marketing-recovery-result-count" aria-live="polite">
          <strong>{filteredLeads.length}</strong> matching{" "}
          {filteredLeads.length === 1 ? "lead" : "leads"}
        </div>
      </div>
      {filteredRecoveryGroups.map((group) => {
        const visibleCount = visibleCounts[group.id] || LEADS_PER_SECTION;
        const visibleLeads = group.leads.slice(0, visibleCount);
        const hiddenLeadCount = group.leads.length - visibleLeads.length;
        return (
          <section className="ops-marketing-date-group" key={group.id}>
            <div className="ops-marketing-date-heading">
              <div>
                <h2>{group.title}</h2>
                <p>{group.description}</p>
              </div>
              <span>
                {visibleLeads.length} of {group.leads.length}{" "}
                {group.leads.length === 1 ? "lead" : "leads"}
              </span>
            </div>
            <div className="ops-marketing-date-items">
              {visibleLeads.map((lead) => {
                const draft = drafts[lead.callId];
                const expanded = expandedLeadId === lead.callId;
                const reviewId = `lead-review-${lead.callId}`;
                return (
                  <article
                    className={`ops-card ops-marketing-lead${expanded ? " is-editing" : ""}`}
                    key={lead.callId}
                  >
                    <div className="ops-marketing-lead-heading">
                      <div>
                        <div className="ops-marketing-lead-name">
                          <strong>{lead.callerName}</strong>
                          <span
                            className={`ops-lead-status is-${draft.status}`}
                          >
                            {
                              STATUS_OPTIONS.find(
                                (item) => item.value === draft.status,
                              )?.label
                            }
                          </span>
                        </div>
                        <div className="ops-muted">
                          {leadDate(lead.calledAt)} · {lead.territory}
                        </div>
                      </div>
                      <div className="ops-marketing-lead-value">
                        <small>Quoted value</small>
                        <strong>
                          {lead.potentialRevenue == null
                            ? "No quote"
                            : dollars(lead.potentialRevenue)}
                        </strong>
                      </div>
                    </div>

                    <div className="ops-marketing-lead-context">
                      <div>
                        <span>Phone</span>
                        {searchKingsPhoneHref(lead.phone) ? (
                          <a
                            className="ops-marketing-phone"
                            href={searchKingsPhoneHref(lead.phone)}
                          >
                            {lead.phone}
                          </a>
                        ) : (
                          <strong>Unavailable</strong>
                        )}
                      </div>
                      <div>
                        <span>Score</span>
                        <strong>{lead.score ?? "—"}/5</strong>
                      </div>
                      <div>
                        <span>Source</span>
                        <strong>
                          {lead.trackingLabel || lead.source || "SearchKings"}
                        </strong>
                      </div>
                      <div>
                        <span>JunkWare match</span>
                        {lead.matchedAppointment ? (
                          <Link
                            className="ops-mini-link"
                            href={appointmentScheduleHref(
                              lead.matchedAppointment.date,
                              lead.matchedAppointment.jobId ||
                                lead.matchedAppointment.appointmentId,
                            )}
                            title={`Open ${lead.matchedAppointment.jobId || "matched job"} on the schedule`}
                          >
                            <strong>
                              {lead.matchedAppointment.jobId || "Matched"}
                            </strong>
                          </Link>
                        ) : (
                          <strong>Not booked</strong>
                        )}
                      </div>
                    </div>
                    {lead.summary ? (
                      <p className="ops-marketing-call-summary">
                        {lead.summary}
                      </p>
                    ) : null}
                    {lead.tags.length ? (
                      <div className="ops-marketing-tags">
                        {lead.tags.map((tag) => (
                          <span key={tag}>{tag}</span>
                        ))}
                      </div>
                    ) : null}
                    {lead.note ? (
                      <p className="ops-marketing-follow-up-note">
                        <strong>Next action:</strong> {lead.note}
                      </p>
                    ) : null}

                    <div className="ops-marketing-lead-actions">
                      {searchKingsPhoneHref(lead.phone) ? (
                        <a
                          className="ops-button ops-marketing-call-button"
                          href={searchKingsPhoneHref(lead.phone)}
                        >
                          Call customer
                        </a>
                      ) : null}
                      <a
                        className="ops-mini-link"
                        href={lead.searchKingsUrl}
                        target="_blank"
                        rel="noreferrer"
                      >
                        Open in SearchKings
                      </a>
                      <button
                        className="ops-button ops-marketing-review-button"
                        type="button"
                        aria-expanded={expanded}
                        aria-controls={reviewId}
                        onClick={() =>
                          setExpandedLeadId(expanded ? "" : lead.callId)
                        }
                      >
                        {expanded ? "Close outcome" : "Update outcome"}
                      </button>
                    </div>

                    {expanded ? (
                      <div className="ops-marketing-lead-review" id={reviewId}>
                        <div className="ops-marketing-lead-form">
                          <label
                            className={`ops-franchise-contact ${draft.franchiseContacted ? "is-contacted" : ""}`}
                          >
                            <input
                              type="checkbox"
                              checked={draft.franchiseContacted}
                              onChange={(event) =>
                                update(lead.callId, {
                                  franchiseContacted: event.target.checked,
                                })
                              }
                            />
                            <span>
                              {draft.franchiseContacted
                                ? "Franchise contacted"
                                : "Franchise not contacted"}
                            </span>
                            <small>Separate from call center</small>
                          </label>
                          <label>
                            Status
                            <select
                              value={draft.status}
                              onChange={(event) =>
                                update(lead.callId, {
                                  status: event.target.value as LostLeadStatus,
                                })
                              }
                            >
                              {STATUS_OPTIONS.map((item) => (
                                <option value={item.value} key={item.value}>
                                  {item.label}
                                </option>
                              ))}
                            </select>
                          </label>
                          <label>
                            Reason
                            <select
                              value={draft.reason}
                              onChange={(event) =>
                                update(lead.callId, {
                                  reason: event.target.value as LostLeadReason,
                                })
                              }
                            >
                              {REASON_OPTIONS.map((item) => (
                                <option value={item.value} key={item.value}>
                                  {item.label}
                                </option>
                              ))}
                            </select>
                          </label>
                          <label className="ops-marketing-note">
                            Follow-up note
                            <input
                              value={draft.note}
                              maxLength={1000}
                              placeholder="What happened, and what is the next action?"
                              onChange={(event) =>
                                update(lead.callId, {
                                  note: event.target.value,
                                })
                              }
                            />
                          </label>
                          <button
                            className="ops-refresh-button"
                            type="button"
                            disabled={saving === lead.callId}
                            onClick={() => save(lead.callId)}
                          >
                            {saving === lead.callId ? "Saving…" : "Save"}
                          </button>
                        </div>
                        {message[lead.callId] ? (
                          <div className="ops-marketing-lead-footer">
                            <span
                              className={
                                message[lead.callId] === "Saved"
                                  ? "ops-kpi-good"
                                  : "ops-kpi-danger"
                              }
                            >
                              {message[lead.callId]}
                            </span>
                          </div>
                        ) : null}
                      </div>
                    ) : null}
                  </article>
                );
              })}
            </div>
            {hiddenLeadCount > 0 ? (
              <button
                className="ops-button ops-marketing-show-older"
                type="button"
                onClick={() =>
                  setVisibleCounts((current) => ({
                    ...current,
                    [group.id]: visibleCount + LEADS_PER_SECTION,
                  }))
                }
              >
                Show {Math.min(LEADS_PER_SECTION, hiddenLeadCount)} more{" "}
                {group.title.toLowerCase()}
              </button>
            ) : null}
          </section>
        );
      })}
      {filteredRecoveryGroups.length === 0 ? (
        <div className="ops-card ops-alert-card">
          <div className="ops-muted">No recovery leads match that search.</div>
        </div>
      ) : null}
    </div>
  );
}
