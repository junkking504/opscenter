"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import type { PodiumReviewAssignmentOption } from "@/lib/podium-review-attribution";
import type { PodiumUnassignedReview } from "@/lib/podium-reviews";

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

export default function PodiumUnassignedReviews({
  reviews,
  appointmentOptions,
}: {
  reviews: PodiumUnassignedReview[];
  appointmentOptions: PodiumReviewAssignmentOption[];
}) {
  const router = useRouter();
  const [pendingReviewUid, setPendingReviewUid] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});

  async function assignReview(event: FormEvent<HTMLFormElement>, reviewUid: string) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const appointmentReference = String(form.get("appointmentReference") || "").trim();
    if (!appointmentReference) return;
    setPendingReviewUid(reviewUid);
    setErrors((current) => ({ ...current, [reviewUid]: "" }));
    try {
      const response = await fetch("/api/integrations/podium/reviews/attribution", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reviewUid, appointmentReference }),
      });
      const payload = await response.json().catch(() => ({})) as { error?: string };
      if (!response.ok) throw new Error(payload.error || "The review could not be assigned.");
      router.refresh();
    } catch (error) {
      setErrors((current) => ({
        ...current,
        [reviewUid]: error instanceof Error ? error.message : "The review could not be assigned.",
      }));
    } finally {
      setPendingReviewUid("");
    }
  }

  return (
    <section className="ops-card ops-marketing-unassigned">
      <div className="ops-card-header compact">
        <div>
          <div className="ops-section-title">Unassigned Reviews</div>
          <div className="ops-muted">
            Last 30 days · {reviews.length} need an appointment and crew assignment
          </div>
        </div>
        <strong className="ops-marketing-unassigned-count">{reviews.length}</strong>
      </div>
      {reviews.length ? (
        <>
          <datalist id="podium-review-appointment-options">
            {appointmentOptions.map((appointment) => (
              <option key={`${appointment.appointmentDate}-${appointment.reference}`} value={appointment.reference}>
                {appointment.label}
              </option>
            ))}
          </datalist>
          <div className="ops-marketing-unassigned-list">
            {reviews.map((review) => (
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
                <form className="ops-marketing-unassigned-form" onSubmit={(event) => assignReview(event, review.uid)}>
                  <label htmlFor={`podium-review-appointment-${review.uid}`}>Completed appointment</label>
                  <div>
                    <input
                      id={`podium-review-appointment-${review.uid}`}
                      name="appointmentReference"
                      list="podium-review-appointment-options"
                      placeholder="Appointment ID or JK number"
                      autoComplete="off"
                      required
                    />
                    <button className="ops-button" type="submit" disabled={pendingReviewUid === review.uid}>
                      {pendingReviewUid === review.uid ? "Assigning…" : "Assign review"}
                    </button>
                  </div>
                  {errors[review.uid] ? <small className="ops-marketing-unassigned-error">{errors[review.uid]}</small> : null}
                </form>
              </article>
            ))}
          </div>
        </>
      ) : (
        <div className="ops-muted">Every recent review has an appointment and crew assignment.</div>
      )}
    </section>
  );
}
