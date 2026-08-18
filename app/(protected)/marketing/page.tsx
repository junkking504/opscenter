import Link from "next/link";
import "./marketing.css";
import LostLeadTracker from "@/components/LostLeadTracker";
import PageHeader from "@/components/PageHeader";
import { appointmentScheduleHref } from "@/lib/job-links";
import { buildGoogleReviewsView, googleReviewsSetupSummary } from "@/lib/google-reviews";
import { money, type AnyRecord } from "@/lib/opsData";
import { groupSearchKingsLeadsByDate } from "@/lib/searchkings-date-groups";
import { buildSearchKingsView, searchKingsSetupSummary } from "@/lib/searchkings";
import { searchKingsPhoneHref } from "@/lib/searchkings-phone";

export const dynamic = "force-dynamic";

function percent(value: number): string {
  return `${value.toFixed(1)}%`;
}

function ratio(value: number): string {
  return `${value.toFixed(2)}×`;
}

function callDate(value: string): string {
  if (!value) return "—";
  return new Date(value).toLocaleString("en-US", {
    timeZone: "America/Chicago",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function statusLabel(value: string): string {
  return value.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function signedNumber(value: number | null, digits = 0): string {
  if (value === null) return "No prior record";
  return `${value > 0 ? "+" : ""}${value.toFixed(digits)}`;
}

export default async function MarketingPage({ searchParams }: { searchParams?: Promise<AnyRecord> }) {
  const params = searchParams ? await searchParams : undefined;
  const requestedSection = String(params?.section || "overview").toLowerCase();
  const section = ["overview", "territory", "calls", "lost-leads", "reviews"].includes(requestedSection)
    ? requestedSection
    : "overview";
  const view = buildSearchKingsView();
  const reviews = buildGoogleReviewsView();
  const date = view.snapshot?.range.endDate || new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Chicago",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
  const callGroups = groupSearchKingsLeadsByDate(view.leads);

  return (
    <div className="ops-dashboard ops-marketing-page">
      <PageHeader
        title="Marketing"
        subtitle={view.available ? `SearchKings performance · ${view.rangeLabel}` : "Marketing performance, lead recovery, and Google Reviews"}
        date={date}
        showDateSelector={false}
        lastUpdated={section === "reviews" ? reviews.snapshot?.fetchedAt : view.snapshot?.fetchedAt}
        status={`${searchKingsSetupSummary()} · ${googleReviewsSetupSummary(reviews)}`}
        sections={[
          { label: "Overview", href: "/marketing?section=overview", active: section === "overview" },
          { label: "Territory", href: "/marketing?section=territory", active: section === "territory" },
          { label: "Calls", href: "/marketing?section=calls", active: section === "calls", badge: view.totalCalls },
          { label: "Lost Leads", href: "/marketing?section=lost-leads", active: section === "lost-leads", badge: view.lostLeads + view.needsFollowUp, attention: view.lostLeads + view.needsFollowUp > 0 },
          { label: "Reviews", href: "/marketing?section=reviews", active: section === "reviews", badge: reviews.userRatingCount ?? undefined },
        ]}
      />

      {!view.available ? (
        <div className="ops-card ops-alert-card">
          <div className="ops-section-title">Waiting for the First SearchKings Refresh</div>
          <div className="ops-muted">{view.error} Once the signed-in collector publishes a snapshot, this page will fill in automatically.</div>
        </div>
      ) : null}

      {view.available && section === "overview" ? <>
        <div className="ops-kpi-row ops-marketing-kpis">
          <div className="ops-card ops-kpi-card"><div className="ops-card-title">Ad Spend</div><div className="ops-kpi-value ops-kpi-accent">{money(view.spend)}</div></div>
          <div className="ops-card ops-kpi-card"><div className="ops-card-title">Platform Conversions</div><div className="ops-kpi-value">{view.platformConversions}</div><div className="ops-kpi-sub">{money(view.costPerConversion)} each</div></div>
          <div className="ops-card ops-kpi-card"><div className="ops-card-title">Qualified Calls</div><div className="ops-kpi-value">{view.qualifiedCalls}</div><div className="ops-kpi-sub">{percent(view.qualifiedRate)} of calls</div></div>
          <div className="ops-card ops-kpi-card"><div className="ops-card-title">Matched Bookings</div><div className="ops-kpi-value ops-kpi-good">{view.bookedJobs}</div><div className="ops-kpi-sub">{money(view.costPerBookedJob)} ad cost each</div></div>
          <div className="ops-card ops-kpi-card"><div className="ops-card-title">Attributed Completed Revenue</div><div className="ops-kpi-value ops-kpi-good">{money(view.attributedRevenue)}</div><div className="ops-kpi-sub">Verified JunkWare jobs · {ratio(view.roas)} ROAS</div></div>
          <div className="ops-card ops-kpi-card"><div className="ops-card-title">Quoted Lost Value</div><div className="ops-kpi-value ops-kpi-danger">{view.valuedLostLeads ? money(view.estimatedLostRevenue) : "Unknown"}</div><div className="ops-kpi-sub">{view.valuedLostLeads} of {view.lostLeads} lost leads state a value</div></div>
        </div>

        <div className="ops-marketing-overview-grid">
          <section className="ops-card">
            <div className="ops-card-header compact"><div><div className="ops-section-title">Call Quality</div><div className="ops-muted">SearchKings scoring is shown separately from booked JunkWare jobs.</div></div></div>
            <div className="ops-summary-list">
              {view.qualityRows.map((row) => <div key={row.label}><span>{row.label}</span><strong>{row.currentTotalCalls} · {percent(row.currentCallPercentage)}</strong></div>)}
            </div>
          </section>
          <section className="ops-card">
            <div className="ops-card-header compact"><div><div className="ops-section-title">Lead Recovery Queue</div><div className="ops-muted">Qualified calls are matched to JunkWare by phone for seven days after the call.</div></div><a className="ops-mini-link" href="/marketing?section=lost-leads">Work queue</a></div>
            <div className="ops-summary-list">
              <div><span>Needs follow-up</span><strong>{view.needsFollowUp}</strong></div>
              <div><span>Lost</span><strong>{view.lostLeads}</strong></div>
              <div><span>Recovered</span><strong>{view.recoveredLeads}</strong></div>
              <div><span>Quoted Lost Value</span><strong>{view.valuedLostLeads ? money(view.estimatedLostRevenue) : "Unknown"}</strong></div>
            </div>
          </section>
          {reviews.available ? <section className="ops-card">
            <div className="ops-card-header compact"><div><div className="ops-section-title">Google Reviews</div><div className="ops-muted">Public rating and review-count changes are tracked between collections.</div></div><a className="ops-mini-link" href="/marketing?section=reviews">View reviews</a></div>
            <div className="ops-summary-list">
              <div><span>Rating</span><strong>{reviews.rating === null ? "Unknown" : `${reviews.rating.toFixed(1)} / 5`}</strong></div>
              <div><span>Ratings</span><strong>{reviews.userRatingCount ?? "Unknown"}</strong></div>
              <div><span>Since last record</span><strong>{reviews.reviewCountChange === null ? "No prior record" : `${signedNumber(reviews.reviewCountChange)} ratings`}</strong></div>
            </div>
          </section> : null}
        </div>
      </> : null}

      {view.available && section === "territory" ? <section className="ops-card">
        <div className="ops-card-header compact"><div><div className="ops-section-title">Territory Performance</div><div className="ops-muted">Ad-platform results and verified JunkWare bookings remain distinct.</div></div></div>
        <div className="ops-table-scroll"><table className="ops-table"><thead><tr><th>Territory</th><th>Spend</th><th>Platform conversions</th><th>Cost / conversion</th><th>Qualified calls</th><th>Matched jobs</th><th>Attributed completed revenue</th><th>Lost leads</th></tr></thead><tbody>{view.territoryRows.map((row) => <tr key={row.territory}><td><strong>{row.territory}</strong></td><td className="ops-money">{money(row.spend)}</td><td>{row.conversions}</td><td className="ops-money">{money(row.costPerConversion)}</td><td>{row.qualifiedCalls}</td><td>{row.bookedJobs}</td><td className="ops-money">{money(row.attributedRevenue)}</td><td>{row.lostLeads}</td></tr>)}</tbody></table></div>
      </section> : null}

      {view.available && section === "calls" ? <section>
        <div className="ops-marketing-section-copy"><div><div className="ops-section-title">SearchKings Calls</div><div className="ops-muted">Calls are grouped by date, newest first. Recordings are not copied into OpsCenter.</div></div></div>
        <div className="ops-marketing-call-groups">
          {callGroups.map((group) => <section className="ops-card ops-marketing-call-group" key={group.dateKey}>
            <div className="ops-marketing-date-heading">
              <h2>{group.label}</h2>
              <span>{group.leads.length} {group.leads.length === 1 ? "call" : "calls"}</span>
            </div>
            <div className="ops-table-scroll"><table className="ops-table"><thead><tr><th>Call</th><th>Phone</th><th>Territory</th><th>Score</th><th>Status</th><th>Franchise contact</th><th>Summary</th><th>JunkWare match</th></tr></thead><tbody>{group.leads.map((lead) => <tr key={lead.callId}><td><strong>{lead.callerName}</strong><small className="ops-table-subline">{callDate(lead.calledAt)}</small></td><td>{searchKingsPhoneHref(lead.phone) ? <a className="ops-marketing-phone" href={searchKingsPhoneHref(lead.phone)}>{lead.phone}</a> : "Unavailable"}</td><td>{lead.territory}</td><td>{lead.score ?? "—"}/5</td><td><span className={`ops-lead-status is-${lead.status}`}>{statusLabel(lead.status)}</span></td><td><span className={`ops-franchise-contact-status ${lead.franchiseContacted ? "is-contacted" : ""}`}>{lead.franchiseContacted ? "Contacted" : "Not contacted"}</span></td><td className="ops-marketing-summary-cell">{lead.summary || "—"}</td><td>{lead.matchedAppointment ? <><Link className="ops-mini-link" href={appointmentScheduleHref(lead.matchedAppointment.date, lead.matchedAppointment.jobId || lead.matchedAppointment.appointmentId)} title={`Open ${lead.matchedAppointment.jobId || "matched job"} on the schedule`}><strong>{lead.matchedAppointment.jobId || "Matched"}</strong></Link><small className="ops-table-subline">{lead.matchedAppointment.completed ? money(lead.matchedAppointment.revenue) : "Not completed — excluded from revenue"}</small></> : "—"}</td></tr>)}</tbody></table></div>
          </section>)}
        </div>
      </section> : null}

      {view.available && section === "lost-leads" ? <section>
        <div className="ops-marketing-section-copy"><div><div className="ops-section-title">Lost Lead Tracker</div><div className="ops-muted">Review qualified calls, record whether the franchise contacted the customer, and preserve the next follow-up action.</div></div></div>
        <LostLeadTracker leads={view.leads} />
      </section> : null}

      {section === "reviews" ? <section>
        {!reviews.available ? <div className="ops-card ops-alert-card">
          <div className="ops-section-title">Waiting for the First Google Reviews Collection</div>
          <div className="ops-muted">{reviews.error} Configure the protected Google Place ID and API key, then run the documented collector.</div>
        </div> : <>
          <div className="ops-marketing-section-copy"><div><div className="ops-section-title">Google Reviews</div><div className="ops-muted">Public Google Places data only. Review-count change is measured against the prior collected snapshot.</div></div></div>
          <div className="ops-kpi-row ops-marketing-reviews-kpis">
            <div className="ops-card ops-kpi-card"><div className="ops-card-title">Google Rating</div><div className="ops-kpi-value ops-kpi-good">{reviews.rating === null ? "Unknown" : `${reviews.rating.toFixed(1)} / 5`}</div><div className="ops-kpi-sub">{reviews.snapshot?.placeName}</div></div>
            <div className="ops-card ops-kpi-card"><div className="ops-card-title">Total Ratings</div><div className="ops-kpi-value">{reviews.userRatingCount ?? "Unknown"}</div><div className="ops-kpi-sub">Current public count</div></div>
            <div className="ops-card ops-kpi-card"><div className="ops-card-title">Rating Change</div><div className="ops-kpi-value">{signedNumber(reviews.ratingChange, 1)}</div><div className="ops-kpi-sub">Since prior record</div></div>
            <div className="ops-card ops-kpi-card"><div className="ops-card-title">Count Change</div><div className="ops-kpi-value">{signedNumber(reviews.reviewCountChange)}</div><div className="ops-kpi-sub">Ratings since prior record</div></div>
          </div>
          <section className="ops-card ops-marketing-reviews-card">
            <div className="ops-card-header compact"><div><div className="ops-section-title">Latest Google Reviews</div><div className="ops-muted">Google returns a limited recent-review set; new labels compare only that set with the prior snapshot.</div></div>{reviews.snapshot?.googleMapsUri ? <a className="ops-mini-link" href={reviews.snapshot.googleMapsUri} target="_blank" rel="noopener noreferrer">Open on Google Maps</a> : null}</div>
            {reviews.reviews.length ? <div className="ops-marketing-reviews-list">
              {reviews.reviews.map((review) => <article className="ops-marketing-review" key={review.name || `${review.authorName}-${review.publishTime}`}>
                <div className="ops-marketing-review-header"><div><strong>{review.authorName}</strong><div className="ops-marketing-review-meta"><span aria-label={`${review.rating} out of 5 stars`}>{"★".repeat(Math.max(0, Math.min(5, Math.round(review.rating))))}{"☆".repeat(Math.max(0, 5 - Math.round(review.rating)))}</span><span>{review.relativePublishTimeDescription || callDate(review.publishTime)}</span></div></div>{review.isNew ? <span className="ops-marketing-new-review">New since last record</span> : null}</div>
                {review.text ? <p>{review.text}</p> : <p className="ops-muted">No review text provided.</p>}
                {review.googleMapsUri ? <a className="ops-mini-link" href={review.googleMapsUri} target="_blank" rel="noopener noreferrer">Open review</a> : null}
              </article>) }
            </div> : <div className="ops-muted ops-marketing-empty-reviews">Google returned no review details with this snapshot.</div>}
          </section>
        </>}
      </section> : null}
    </div>
  );
}
