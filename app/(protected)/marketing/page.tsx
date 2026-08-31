import Link from "next/link";
import "./marketing.css";
import LostLeadTracker from "@/components/LostLeadTracker";
import OpsMonthSelector, { type MonthOption } from "@/components/OpsMonthSelector";
import PageHeader from "@/components/PageHeader";
import { appointmentScheduleHref } from "@/lib/job-links";
import { money, type AnyRecord } from "@/lib/opsData";
import {
  buildSearchKingsCallBrowser,
  type SearchKingsCallFilter,
  type SearchKingsCallRange,
} from "@/lib/searchkings-call-browser";
import {
  availableSearchKingsMonths,
  buildSearchKingsView,
  searchKingsSetupSummary,
} from "@/lib/searchkings";
import { searchKingsPhoneHref } from "@/lib/searchkings-phone";
import {
  buildPodiumGoogleReviewsView,
  podiumReviewsSetupSummary,
} from "@/lib/podium-reviews";

export const dynamic = "force-dynamic";

function percent(value: number): string {
  return `${value.toFixed(1)}%`;
}

function ratio(value: number): string {
  return `${value.toFixed(2)}×`;
}

function jobCountChangeLabel(change: {
  current: number;
  previous: number;
  percentage: number | null;
  comparisonAvailable: boolean;
}): string {
  if (!change.comparisonAvailable) return "Prior 7-day comparison unavailable";
  if (change.percentage == null) {
    return change.current === 0
      ? "No matched jobs in either 7-day window"
      : `${change.current} new vs prior 7 days`;
  }
  const direction = change.percentage > 0 ? "↑" : change.percentage < 0 ? "↓" : "→";
  return `${direction} ${Math.abs(change.percentage).toFixed(1)}% vs prior 7 days`;
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
  return value
    .replaceAll("_", " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function reviewDate(value: string): string {
  if (!value) return "Date unavailable";
  return new Date(value).toLocaleString("en-US", {
    timeZone: "America/Chicago",
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function callsHref(
  date: string,
  range: SearchKingsCallRange,
  filter: SearchKingsCallFilter,
  query: string,
  page: number,
): string {
  const params = new URLSearchParams({ date, view: "monthly", section: "calls", range });
  if (filter !== "all") params.set("filter", filter);
  if (query) params.set("q", query);
  if (page > 1) params.set("page", String(page));
  return `/marketing?${params.toString()}`;
}

function validDate(value: unknown): value is string {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function monthOptions(): MonthOption[] {
  return availableSearchKingsMonths().map((key) => ({
    key,
    date: `${key}-01`,
    label: new Intl.DateTimeFormat("en-US", { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${key}-01T12:00:00Z`)),
  }));
}

export default async function MarketingPage({
  searchParams,
}: {
  searchParams?: Promise<AnyRecord>;
}) {
  const params = searchParams ? await searchParams : undefined;
  const requestedSection = String(params?.section || "overview").toLowerCase();
  const section = ["overview", "territory", "calls", "lost-leads", "reviews"].includes(
    requestedSection,
  )
    ? requestedSection
    : "overview";
  const months = monthOptions();
  const requestedDate = validDate(params?.date) ? params.date : "";
  const selectedMonthKey = requestedDate.slice(0, 7) || months[0]?.key || "";
  const view = buildSearchKingsView(selectedMonthKey || undefined);
  const date = requestedDate || view.snapshot?.range.endDate ||
    new Intl.DateTimeFormat("en-CA", {
      timeZone: "America/Chicago",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date());
  const marketingHref = (nextSection: string) => `/marketing?date=${encodeURIComponent(date)}&view=monthly&section=${nextSection}`;
  const calls = buildSearchKingsCallBrowser(view.leads, {
    range: params?.range || (requestedDate ? "all" : undefined),
    filter: params?.filter,
    query: params?.q,
    page: params?.page,
  });
  const reviews = buildPodiumGoogleReviewsView();

  return (
    <div className="ops-dashboard ops-marketing-page">
      <PageHeader
        title="Marketing"
        subtitle={
          section === "reviews"
            ? "Newest Google reviews from Podium"
            : view.available
            ? `SearchKings performance · ${view.rangeLabel}`
            : "SearchKings performance and lead recovery"
        }
        date={date}
        showDateSelector={false}
        dateLabel="Month"
        lastUpdated={section === "reviews" ? reviews.snapshot?.fetchedAt : view.snapshot?.fetchedAt}
        status={section === "reviews" ? podiumReviewsSetupSummary(reviews) : searchKingsSetupSummary()}
        controls={section === "reviews" ? undefined : <OpsMonthSelector months={months} selectedMonthKey={selectedMonthKey} />}
        sections={[
          {
            label: "Overview",
            href: marketingHref("overview"),
            active: section === "overview",
          },
          {
            label: "Territory",
            href: marketingHref("territory"),
            active: section === "territory",
          },
          {
            label: "Calls",
            href: marketingHref("calls"),
            active: section === "calls",
            badge: view.totalCalls,
          },
          {
            label: "Lost Leads",
            href: marketingHref("lost-leads"),
            active: section === "lost-leads",
            badge: view.lostLeads + view.needsFollowUp,
            attention: view.lostLeads + view.needsFollowUp > 0,
          },
          {
            label: "Reviews",
            href: marketingHref("reviews"),
            active: section === "reviews",
            badge: reviews.recentNeedsResponse,
            attention: reviews.recentNeedsResponse > 0,
          },
        ]}
      />

      {!view.available && section !== "reviews" ? (
        <div className="ops-card ops-alert-card">
          <div className="ops-section-title">
            Waiting for the First SearchKings Refresh
          </div>
          <div className="ops-muted">
            {view.error} Once the signed-in collector publishes a snapshot, this
            page will fill in automatically.
          </div>
        </div>
      ) : null}

      {view.available && section === "overview" ? (
        <>
          <section className="ops-card ops-marketing-recovery-alert">
            <div>
              <div className="ops-section-title">SearchKings Lead Recovery</div>
              <div className="ops-muted">
                {view.lostLeads + view.needsFollowUp > 0
                  ? `${view.lostLeads} lost and ${view.needsFollowUp} needing follow-up. Call the customer, then record the outcome before it disappears into reporting.`
                  : "No SearchKings calls currently need a recovery outcome."}
              </div>
            </div>
            <div className="ops-marketing-recovery-alert-actions">
              <strong>{view.lostLeads + view.needsFollowUp} to work</strong>
              <Link className="ops-button" href="/marketing?section=lost-leads">
                {view.lostLeads + view.needsFollowUp > 0
                  ? "Work recovery queue"
                  : "View lead history"}
              </Link>
            </div>
          </section>
          <div className="ops-kpi-row ops-marketing-kpis ops-marketing-review-kpis">
            <Link
              className="ops-card ops-kpi-card ops-marketing-action-kpi"
              href="/marketing?section=lost-leads"
            >
              <div className="ops-card-title">Leads to Recover</div>
              <div className="ops-kpi-value ops-kpi-danger">
                {view.lostLeads + view.needsFollowUp}
              </div>
              <div className="ops-kpi-sub">
                {view.lostLeads} lost · {view.needsFollowUp} need follow-up
              </div>
            </Link>
            <Link
              className="ops-card ops-kpi-card ops-marketing-action-kpi"
              href="/marketing?section=calls&range=all&filter=quoted_lost"
            >
              <div className="ops-card-title">Quoted Value at Risk</div>
              <div className="ops-kpi-value ops-kpi-danger">
                {view.valuedLostLeads
                  ? money(view.estimatedLostRevenue)
                  : "No quoted value"}
              </div>
              <div className="ops-kpi-sub">
                Explicit quotes in {view.valuedLostLeads} of {view.lostLeads}{" "}
                lost-call summaries
              </div>
            </Link>
            <Link
              className="ops-card ops-kpi-card ops-marketing-action-kpi"
              href="/marketing?section=calls&range=all&filter=completed_revenue"
            >
              <div className="ops-card-title">Verified Completed Revenue</div>
              <div className="ops-kpi-value ops-kpi-good">
                {money(view.attributedRevenue)}
              </div>
              <div className="ops-kpi-sub">
                JunkWare completed jobs · {ratio(view.roas)} ROAS
              </div>
            </Link>
            <Link
              className="ops-card ops-kpi-card ops-marketing-action-kpi"
              href="/marketing?section=calls&range=all&filter=matched_booking"
            >
              <div className="ops-card-title">Matched JunkWare Bookings</div>
              <div className="ops-kpi-value ops-kpi-good">
                {view.bookedJobs}
              </div>
              <div className="ops-kpi-sub">
                Phone matches · {money(view.costPerBookedJob)} ad cost each
              </div>
              <div className="ops-kpi-sub ops-marketing-job-count-change">
                Last 7 days: {view.bookedJobsChange.current} · {jobCountChangeLabel(view.bookedJobsChange)}
              </div>
            </Link>
            <Link
              className="ops-card ops-kpi-card ops-marketing-action-kpi"
              href="/marketing?section=calls&range=all&filter=qualified"
            >
              <div className="ops-card-title">Qualified SearchKings Calls</div>
              <div className="ops-kpi-value">{view.qualifiedCalls}</div>
              <div className="ops-kpi-sub">
                Score 3–5 · {percent(view.qualifiedRate)} of calls
              </div>
            </Link>
            <Link
              className="ops-card ops-kpi-card ops-marketing-action-kpi"
              href="/marketing?section=territory"
            >
              <div className="ops-card-title">SearchKings Reporting</div>
              <div className="ops-kpi-value ops-kpi-accent">
                {money(view.spend)}
              </div>
              <div className="ops-kpi-sub">
                {view.platformConversions} platform conversions ·{" "}
                {money(view.costPerConversion)} each
              </div>
            </Link>
          </div>

          <div className="ops-marketing-overview-grid">
            <section className="ops-card">
              <div className="ops-card-header compact">
                <div>
                  <div className="ops-section-title">Call Quality</div>
                  <div className="ops-muted">
                    SearchKings scoring is shown separately from booked JunkWare
                    jobs.
                  </div>
                </div>
              </div>
              <div className="ops-summary-list">
                {view.qualityRows.map((row) => (
                  <div key={row.label}>
                    <span>{row.label}</span>
                    <strong>
                      {row.currentTotalCalls} ·{" "}
                      {percent(row.currentCallPercentage)}
                    </strong>
                  </div>
                ))}
              </div>
            </section>
            <section className="ops-card">
              <div className="ops-card-header compact">
                <div>
                  <div className="ops-section-title">Lead Recovery Queue</div>
                  <div className="ops-muted">
                    Only calls that are lost or still need follow-up are work
                    items. A phone match is checked for seven days after the
                    call.
                  </div>
                </div>
                <Link
                  className="ops-mini-link"
                  href="/marketing?section=lost-leads"
                >
                  Work queue
                </Link>
              </div>
              <div className="ops-summary-list">
                <div>
                  <span>Needs follow-up</span>
                  <strong>{view.needsFollowUp}</strong>
                </div>
                <div>
                  <span>Lost</span>
                  <strong>{view.lostLeads}</strong>
                </div>
                <div>
                  <span>Recovered</span>
                  <strong>{view.recoveredLeads}</strong>
                </div>
                <div>
                  <span>Quoted value at risk</span>
                  <strong>
                    {view.valuedLostLeads
                      ? money(view.estimatedLostRevenue)
                      : "No quoted value"}
                  </strong>
                </div>
              </div>
            </section>
          </div>
        </>
      ) : null}

      {view.available && section === "territory" ? (
        <section className="ops-card">
          <div className="ops-card-header compact">
            <div>
              <div className="ops-section-title">Territory Performance</div>
              <div className="ops-muted">
                Ad-platform results and verified JunkWare bookings remain
                distinct.
              </div>
            </div>
          </div>
          <div className="ops-table-scroll">
            <table className="ops-table">
              <thead>
                <tr>
                  <th>Territory</th>
                  <th>Spend</th>
                  <th>Platform conversions</th>
                  <th>Cost / conversion</th>
                  <th>Qualified calls</th>
                  <th>Matched jobs</th>
                  <th>Attributed completed revenue</th>
                  <th>Lost leads</th>
                </tr>
              </thead>
              <tbody>
                {view.territoryRows.map((row) => (
                  <tr key={row.territory}>
                    <td>
                      <strong>{row.territory}</strong>
                    </td>
                    <td className="ops-money">{money(row.spend)}</td>
                    <td>{row.conversions}</td>
                    <td className="ops-money">
                      {money(row.costPerConversion)}
                    </td>
                    <td>{row.qualifiedCalls}</td>
                    <td>{row.bookedJobs}</td>
                    <td className="ops-money">
                      {money(row.attributedRevenue)}
                    </td>
                    <td>{row.lostLeads}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}

      {view.available && section === "calls" ? (
        <section>
          <div className="ops-marketing-section-copy">
            <div>
              <div className="ops-section-title">SearchKings Calls</div>
              <div className="ops-muted">
                Newest calls appear first. Search or expand the date range when
                reviewing history.
              </div>
            </div>
          </div>
          <form className="ops-card ops-marketing-call-toolbar" method="get">
            <input type="hidden" name="date" value={date} />
            <input type="hidden" name="view" value="monthly" />
            <input type="hidden" name="section" value="calls" />
            <label>
              <span>Find calls</span>
              <input
                name="q"
                type="search"
                defaultValue={calls.query}
                placeholder="Name, phone, territory, summary, or JK #"
              />
            </label>
            <label>
              <span>Date range</span>
              <select name="range" defaultValue={calls.range}>
                <option value="latest">Latest day</option>
                <option value="7">Last 7 active days</option>
                <option value="all">All dates</option>
              </select>
            </label>
            <label>
              <span>Call type</span>
              <select name="filter" defaultValue={calls.filter}>
                <option value="all">All calls</option>
                <option value="quoted_lost">Quoted, not booked</option>
                <option value="completed_revenue">Completed matched jobs</option>
                <option value="matched_booking">Matched JunkWare bookings</option>
                <option value="qualified">Qualified calls (score 3–5)</option>
              </select>
            </label>
            <button className="ops-refresh-button" type="submit">
              Search
            </button>
            {calls.query || calls.range !== "latest" || calls.filter !== "all" ? (
              <Link
                className="ops-button ops-marketing-call-clear"
                href="/marketing?section=calls"
              >
                Clear
              </Link>
            ) : null}
            <div className="ops-marketing-call-count" aria-live="polite">
              <strong>
                {calls.firstResult}–{calls.lastResult}
              </strong>{" "}
              of {calls.matchCount} calls
              {calls.matchCount !== calls.totalInRange
                ? ` · ${calls.totalInRange} in range`
                : ""}
            </div>
          </form>
          <div className="ops-marketing-call-groups">
            {calls.groups.map((group) => (
              <section
                className="ops-card ops-marketing-call-group"
                key={group.dateKey}
              >
                <div className="ops-marketing-date-heading">
                  <h2>{group.label}</h2>
                  <span>
                    {group.leads.length}{" "}
                    {group.leads.length === 1 ? "call" : "calls"}
                  </span>
                </div>
                <div className="ops-table-scroll ops-marketing-call-table">
                  <table className="ops-table">
                    <thead>
                      <tr>
                        <th>Call</th>
                        <th>Phone</th>
                        <th>Territory</th>
                        <th>Score</th>
                        <th>Status</th>
                        <th>Franchise contact</th>
                        <th>Summary</th>
                        <th>JunkWare match</th>
                      </tr>
                    </thead>
                    <tbody>
                      {group.leads.map((lead) => (
                        <tr key={lead.callId}>
                          <td>
                            <strong>{lead.callerName}</strong>
                            <small className="ops-table-subline">
                              {callDate(lead.calledAt)}
                            </small>
                          </td>
                          <td>
                            {searchKingsPhoneHref(lead.phone) ? (
                              <a
                                className="ops-marketing-phone"
                                href={searchKingsPhoneHref(lead.phone)}
                              >
                                {lead.phone}
                              </a>
                            ) : (
                              "Unavailable"
                            )}
                          </td>
                          <td>{lead.territory}</td>
                          <td>{lead.score ?? "—"}/5</td>
                          <td>
                            <span
                              className={`ops-lead-status is-${lead.status}`}
                            >
                              {statusLabel(lead.status)}
                            </span>
                          </td>
                          <td>
                            <span
                              className={`ops-franchise-contact-status ${lead.franchiseContacted ? "is-contacted" : ""}`}
                            >
                              {lead.franchiseContacted
                                ? "Contacted"
                                : "Not contacted"}
                            </span>
                          </td>
                          <td className="ops-marketing-summary-cell">
                            {lead.summary || "—"}
                          </td>
                          <td>
                            {lead.matchedAppointment ? (
                              <>
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
                                <small className="ops-table-subline">
                                  {lead.matchedAppointment.completed
                                    ? money(lead.matchedAppointment.revenue)
                                    : "Not completed — excluded from revenue"}
                                </small>
                              </>
                            ) : (
                              "—"
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="ops-marketing-call-cards">
                  {group.leads.map((lead) => (
                    <article
                      className="ops-marketing-call-card"
                      key={`mobile-${lead.callId}`}
                    >
                      <header>
                        <div>
                          <strong>{lead.callerName}</strong>
                          <small>
                            {callDate(lead.calledAt)} · {lead.territory}
                          </small>
                        </div>
                        <span className={`ops-lead-status is-${lead.status}`}>
                          {statusLabel(lead.status)}
                        </span>
                      </header>
                      <p>{lead.summary || "No call summary available."}</p>
                      <footer>
                        {searchKingsPhoneHref(lead.phone) ? (
                          <a
                            className="ops-marketing-phone"
                            href={searchKingsPhoneHref(lead.phone)}
                          >
                            {lead.phone}
                          </a>
                        ) : (
                          <span>Phone unavailable</span>
                        )}
                        <span>
                          {lead.franchiseContacted
                            ? "Contacted"
                            : "Not contacted"}
                        </span>
                        {lead.matchedAppointment ? (
                          <Link
                            className="ops-mini-link"
                            href={appointmentScheduleHref(
                              lead.matchedAppointment.date,
                              lead.matchedAppointment.jobId ||
                                lead.matchedAppointment.appointmentId,
                            )}
                          >
                            {lead.matchedAppointment.jobId || "Matched job"}
                          </Link>
                        ) : null}
                      </footer>
                    </article>
                  ))}
                </div>
              </section>
            ))}
            {calls.groups.length === 0 ? (
              <div className="ops-card ops-marketing-call-empty">
                <strong>No matching calls</strong>
                <span>Adjust the search or date range.</span>
              </div>
            ) : null}
          </div>
          {calls.totalPages > 1 ? (
            <nav
              className="ops-marketing-call-pagination"
              aria-label="Call results pages"
            >
              {calls.page > 1 ? (
                <Link
                  className="ops-button"
                  href={callsHref(date, calls.range, calls.filter, calls.query, calls.page - 1)}
                >
                  Previous
                </Link>
              ) : (
                <span />
              )}
              <span>
                Page {calls.page} of {calls.totalPages}
              </span>
              {calls.page < calls.totalPages ? (
                <Link
                  className="ops-button"
                  href={callsHref(date, calls.range, calls.filter, calls.query, calls.page + 1)}
                >
                  Next
                </Link>
              ) : (
                <span />
              )}
            </nav>
          ) : null}
        </section>
      ) : null}

      {view.available && section === "lost-leads" ? (
        <section>
          <div className="ops-marketing-section-copy">
            <div>
              <div className="ops-section-title">
                SearchKings Recovery Queue
              </div>
              <div className="ops-muted">
                Lost leads come first, followed by calls needing follow-up.
                Call, then save the outcome. Booked, recovered, and unqualified
                calls remain in Calls.
              </div>
            </div>
          </div>
          <LostLeadTracker leads={view.leads} />
        </section>
      ) : null}

      {section === "reviews" && !reviews.available ? (
        <section className="ops-card">
          <div className="ops-card-header compact">
            <div>
              <div className="ops-section-title">Connect Podium Reviews</div>
              <div className="ops-muted">
                {params?.podium === "connected"
                  ? "Podium authorization is saved. The first collector run will populate this page."
                  : podiumReviewsSetupSummary(reviews)}
              </div>
            </div>
            <a className="ops-button" href="/api/integrations/podium/connect">
              Authorize Podium
            </a>
          </div>
        </section>
      ) : null}

      {section === "reviews" && reviews.available ? (
        <>
          <div className="ops-kpi-row ops-marketing-kpis">
            <section className="ops-card ops-kpi-card">
              <div className="ops-card-title">Google Reviews</div>
              <div className="ops-kpi-value">{reviews.totalReviewCount}</div>
              <div className="ops-kpi-sub">Across {reviews.locations.length} Podium locations</div>
            </section>
            <section className="ops-card ops-kpi-card">
              <div className="ops-card-title">Average Rating</div>
              <div className="ops-kpi-value ops-kpi-good">
                {reviews.weightedAverageRating?.toFixed(2) || "—"}
              </div>
              <div className="ops-kpi-sub">Weighted by each location&apos;s Google review count</div>
            </section>
            <section className="ops-card ops-kpi-card">
              <div className="ops-card-title">Needs Response</div>
              <div className={`ops-kpi-value ${reviews.recentNeedsResponse ? "ops-kpi-danger" : "ops-kpi-good"}`}>
                {reviews.recentNeedsResponse}
              </div>
              <div className="ops-kpi-sub">Recent Google feed · {reviews.recentLowRatings} at 3 stars or lower</div>
            </section>
            <section className="ops-card ops-kpi-card">
              <div className="ops-card-title">New Reviews</div>
              <div className="ops-kpi-value">{reviews.new7Days}</div>
              <div className="ops-kpi-sub">
                {reviews.newToday} today · {reviews.new30Days} in the last 30 days
              </div>
            </section>
          </div>
          <section className="ops-card ops-marketing-review-credit">
            <div className="ops-card-header compact">
              <div>
                <div className="ops-section-title">Appointment &amp; Crew Review Credit</div>
                <div className="ops-muted">
                  Last 30 days · {reviews.attributed30Days} exact appointment matches · {reviews.pendingAttribution30Days} unassigned
                </div>
              </div>
            </div>
            <div className="ops-marketing-review-credit-grid">
              <div>
                <h3>Employees</h3>
                <div className="ops-marketing-review-credit-list">
                  {reviews.employeeTallies30Days.slice(0, 12).map((entry) => (
                    <div className="ops-marketing-review-credit-row" key={entry.name}>
                      <strong>{entry.name}</strong>
                      <span>{entry.reviewCount} {entry.reviewCount === 1 ? "review" : "reviews"} · {entry.averageRating.toFixed(1)} ★</span>
                    </div>
                  ))}
                  {reviews.employeeTallies30Days.length === 0 ? (
                    <div className="ops-muted">No recent reviews have an exact crew match yet.</div>
                  ) : null}
                </div>
              </div>
              <div>
                <h3>Teams</h3>
                <div className="ops-marketing-review-credit-list">
                  {reviews.teamTallies30Days.slice(0, 12).map((entry) => (
                    <div className="ops-marketing-review-credit-row" key={entry.name}>
                      <strong>{entry.name}</strong>
                      <span>{entry.reviewCount} {entry.reviewCount === 1 ? "review" : "reviews"} · {entry.averageRating.toFixed(1)} ★</span>
                    </div>
                  ))}
                  {reviews.teamTallies30Days.length === 0 ? (
                    <div className="ops-muted">No recent reviews have an exact team match yet.</div>
                  ) : null}
                </div>
              </div>
            </div>
          </section>
          <div className="ops-marketing-review-grid">
            {reviews.locations.map((location) => (
              <section className="ops-card" key={location.uid}>
                <div className="ops-card-header compact">
                  <div>
                    <div className="ops-section-title">{location.name}</div>
                    <div className="ops-muted">{location.address || "Address unavailable"}</div>
                  </div>
                  <div className="ops-marketing-review-summary">
                    <strong>{location.averageRating?.toFixed(2) || "—"} ★</strong>
                    <span>
                      {location.reviewCount} total reviews
                    </span>
                    <span className="ops-marketing-review-territory-tally">
                      +{location.newToday} today · +{location.new7Days} last 7 days · +{location.new30Days} last 30 days
                    </span>
                  </div>
                </div>
                <div className="ops-marketing-review-list">
                  {location.reviews.slice(0, 12).map((review) => (
                    <article className="ops-marketing-review-card" key={review.uid}>
                      <header>
                        <div>
                          <strong>{review.authorName}</strong>
                          <small>{reviewDate(review.createdAt)}</small>
                        </div>
                        <span>{"★".repeat(Math.max(0, Math.min(5, review.rating)))}</span>
                      </header>
                      <p>{review.body || "Rating submitted without written feedback."}</p>
                      {review.attribution?.status === "matched" ? (
                        <div className="ops-marketing-review-attribution">
                          <span>
                            Credited to {review.attribution.crew?.join(" + ") || "crew not recorded"}
                            {review.attribution.jkNumber ? ` · ${review.attribution.jkNumber}` : ""}
                            {review.attribution.appointmentDate ? ` · ${review.attribution.appointmentDate}` : ""}
                          </span>
                          {review.attribution.appointmentUrl ? (
                            <a className="ops-mini-link" href={review.attribution.appointmentUrl} target="_blank" rel="noreferrer">
                              Open appointment
                            </a>
                          ) : null}
                        </div>
                      ) : review.attribution?.status === "ambiguous" ? (
                        <div className="ops-marketing-review-attribution is-pending">
                          Appointment match needs review
                        </div>
                      ) : null}
                      <footer>
                        <span className={review.needsResponse ? "ops-lead-status is-lost" : "ops-lead-status is-recovered"}>
                          {review.needsResponse ? "Needs response" : review.responseCount ? "Responded" : "No response needed"}
                        </span>
                        {review.url ? (
                          <a className="ops-mini-link" href={review.url} target="_blank" rel="noreferrer">
                            Open Google review
                          </a>
                        ) : null}
                      </footer>
                    </article>
                  ))}
                  {location.reviews.length === 0 ? (
                    <div className="ops-muted">No recent Google reviews were returned for this location.</div>
                  ) : null}
                </div>
              </section>
            ))}
          </div>
        </>
      ) : null}
    </div>
  );
}
