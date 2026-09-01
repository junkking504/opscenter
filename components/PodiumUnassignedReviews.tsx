"use client";

import Link from "next/link";
import { useState, type FormEvent } from "react";
import type {
  PodiumReviewAssignmentOption,
  PodiumReviewNameSuggestion,
} from "@/lib/podium-review-attribution";
import type { PodiumUnassignedReview } from "@/lib/podium-reviews";

const appointmentListId = "podium-review-appointment-options";

function reviewDate(value: string): string {
  return new Date(value).toLocaleString("en-US", {
    timeZone: "America/Chicago",
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function nameMatchLabel(kind: PodiumReviewNameSuggestion["matchKind"]): string {
  if (kind === "name_initial") return "Customer name and initial match";
  if (kind === "exact_first_last") return "Customer first and last name match";
  return "Exact customer-name match";
}

async function requestAssignment(
  reviewUid: string,
  appointmentReference: string,
  assignmentMode: "confirm_suggestion" | "reassign",
): Promise<void> {
  const response = await fetch("/api/integrations/podium/reviews/attribution", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ reviewUid, appointmentReference, assignmentMode }),
  });
  const payload = await response.json().catch(() => ({})) as { error?: string };
  if (!response.ok) throw new Error(payload.error || "The review could not be assigned.");
}

export function PodiumReviewReassignControl({
  reviewUid,
  jkNumber,
}: {
  reviewUid: string;
  jkNumber: string;
}) {
  const [editing, setEditing] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  async function reassign(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const appointmentReference = String(form.get("appointmentReference") || "").trim();
    if (!appointmentReference) return;
    setPending(true);
    setError("");
    try {
      await requestAssignment(reviewUid, appointmentReference, "reassign");
      setEditing(false);
      setNotice("Re-assignment approval requested in OpsBot Control.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The review could not be re-assigned.");
    } finally {
      setPending(false);
    }
  }

  if (!editing) {
    return (
      <div>
        <button className="ops-mini-link ops-marketing-review-reassign-button" type="button" onClick={() => { setEditing(true); setNotice(""); }}>
          Re-assign {jkNumber || "review"}
        </button>
        {notice ? <small className="ops-marketing-unassigned-notice">{notice} <Link href="/?section=opsbot">Open OpsBot Control</Link></small> : null}
      </div>
    );
  }

  return (
    <form className="ops-marketing-review-reassign" onSubmit={reassign}>
      <label htmlFor={`podium-review-reassign-${reviewUid}`}>New completed appointment</label>
      <div>
        <input
          id={`podium-review-reassign-${reviewUid}`}
          name="appointmentReference"
          list={appointmentListId}
          placeholder="Customer name, appointment ID, or JK number"
          autoComplete="off"
          required
        />
        <button className="ops-button" type="submit" disabled={pending}>
          {pending ? "Saving…" : "Save"}
        </button>
        <button className="ops-mini-link" type="button" onClick={() => { setEditing(false); setError(""); }}>
          Cancel
        </button>
      </div>
      {error ? <small className="ops-marketing-unassigned-error">{error}</small> : null}
    </form>
  );
}

export default function PodiumUnassignedReviews({
  reviews,
  appointmentOptions,
  suggestionsByReviewUid,
}: {
  reviews: PodiumUnassignedReview[];
  appointmentOptions: PodiumReviewAssignmentOption[];
  suggestionsByReviewUid: Record<string, PodiumReviewNameSuggestion[]>;
}) {
  const [pendingReviewUid, setPendingReviewUid] = useState("");
  const [manualReviewUid, setManualReviewUid] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [notices, setNotices] = useState<Record<string, string>>({});

  async function assignReference(
    reviewUid: string,
    appointmentReference: string,
    assignmentMode: "confirm_suggestion" | "reassign",
  ) {
    if (!appointmentReference) return;
    setPendingReviewUid(reviewUid);
    setErrors((current) => ({ ...current, [reviewUid]: "" }));
    try {
      await requestAssignment(reviewUid, appointmentReference, assignmentMode);
      setManualReviewUid("");
      setNotices((current) => ({ ...current, [reviewUid]: "Attribution approval requested in OpsBot Control." }));
    } catch (caught) {
      setErrors((current) => ({
        ...current,
        [reviewUid]: caught instanceof Error ? caught.message : "The review could not be assigned.",
      }));
    } finally {
      setPendingReviewUid("");
    }
  }

  async function assignReview(event: FormEvent<HTMLFormElement>, reviewUid: string) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    await assignReference(reviewUid, String(form.get("appointmentReference") || "").trim(), "reassign");
  }

  return (
    <section className="ops-card ops-marketing-unassigned">
      <datalist id={appointmentListId}>
        {appointmentOptions.map((appointment) => (
          <option key={`${appointment.appointmentDate}-${appointment.reference}`} value={appointment.reference}>
            {appointment.label}
          </option>
        ))}
      </datalist>
      <div className="ops-card-header compact">
        <div>
          <div className="ops-section-title">Unassigned Reviews</div>
          <div className="ops-muted">
            Last 30 days · {reviews.length} need a confirmed appointment and crew assignment
          </div>
        </div>
        <strong className="ops-marketing-unassigned-count">{reviews.length}</strong>
      </div>
      {reviews.length ? (
        <div className="ops-marketing-unassigned-list">
          {reviews.map((review) => {
            const suggestions = suggestionsByReviewUid[review.uid] || [];
            const suggestion = suggestions[0];
            const showManual = manualReviewUid === review.uid || !suggestion;
            return (
              <article className="ops-marketing-unassigned-review" key={review.uid}>
                <div className="ops-marketing-unassigned-copy">
                  <header>
                    <div>
                      <strong>{review.authorName}</strong>
                      <small>{review.locationName} · {reviewDate(review.createdAt)}</small>
                    </div>
                    <span>{"★".repeat(Math.max(0, Math.min(5, review.rating)))}</span>
                  </header>
                  <p>{review.body || "Rating submitted without written feedback."}</p>
                </div>
                <div className="ops-marketing-unassigned-assignment">
                  {suggestion ? (
                    <div className="ops-marketing-review-suggestion">
                      <small>{nameMatchLabel(suggestion.matchKind)}</small>
                      <strong>{suggestion.customerName}</strong>
                      <div>
                        <b>{suggestion.jkNumber || "JK number unavailable"}</b>
                        <span>{suggestion.appointmentDate} · {suggestion.territory || "Territory unavailable"}</span>
                      </div>
                      <span>Crew: {suggestion.crew.join(" + ")}</span>
                      {suggestions.length > 1 ? (
                        <small>{suggestions.length} matching completed appointments found; the best match is shown.</small>
                      ) : null}
                      <div className="ops-marketing-review-suggestion-actions">
                        <button
                          className="ops-button"
                          type="button"
                          disabled={pendingReviewUid === review.uid}
                          onClick={() => assignReference(review.uid, suggestion.reference, "confirm_suggestion")}
                        >
                          {pendingReviewUid === review.uid ? "Confirming…" : `Confirm ${suggestion.jkNumber || "appointment"}`}
                        </button>
                        <button
                          className="ops-mini-link"
                          type="button"
                          onClick={() => setManualReviewUid(review.uid)}
                        >
                          Re-assign review
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="ops-marketing-review-no-suggestion">
                      No confident customer-name match was found. Choose a completed appointment below.
                    </div>
                  )}
                  {showManual ? (
                    <form className="ops-marketing-unassigned-form" onSubmit={(event) => assignReview(event, review.uid)}>
                      <label htmlFor={`podium-review-appointment-${review.uid}`}>
                        {suggestion ? "Choose a different completed appointment" : "Completed appointment"}
                      </label>
                      <div>
                        <input
                          id={`podium-review-appointment-${review.uid}`}
                          name="appointmentReference"
                          list={appointmentListId}
                          placeholder="Customer name, appointment ID, or JK number"
                          autoComplete="off"
                          required
                        />
                        <button className="ops-button" type="submit" disabled={pendingReviewUid === review.uid}>
                          {pendingReviewUid === review.uid ? "Assigning…" : "Assign review"}
                        </button>
                      </div>
                    </form>
                  ) : null}
                  {errors[review.uid] ? <small className="ops-marketing-unassigned-error">{errors[review.uid]}</small> : null}
                  {notices[review.uid] ? <small className="ops-marketing-unassigned-notice">{notices[review.uid]} <Link href="/?section=opsbot">Open approval ledger</Link></small> : null}
                </div>
              </article>
            );
          })}
        </div>
      ) : (
        <div className="ops-muted">Every recent review has a confirmed appointment and crew assignment.</div>
      )}
    </section>
  );
}
