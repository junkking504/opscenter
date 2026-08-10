import Link from "next/link";
import type { CrewCallInPlan as CrewCallInPlanData } from "@/lib/crew-call-in-recommendations";

function shortDate(date: string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "UTC",
    weekday: "long",
    month: "short",
    day: "numeric",
  }).format(new Date(`${date}T12:00:00Z`));
}

function updatedLabel(value: string | null): string {
  if (!value) return "Update time unavailable";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "Update time unavailable";
  return `Schedule checked ${new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Chicago",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(parsed)}`;
}

export default function CrewCallInPlan({ plan, id }: { plan: CrewCallInPlanData; id?: string }) {
  return (
    <section className="ops-card ops-crew-section ops-call-in-section" id={id}>
      <div className="ops-card-header compact">
        <div>
          <div className="ops-section-title-row">
            <div className="ops-section-title">Tomorrow’s Call-In Plan</div>
            <span className="ops-section-badge ops-section-badge-call-in">Recommended</span>
          </div>
          <div className="ops-muted">
            {shortDate(plan.targetDate)} · Suggested staffing based on tomorrow’s appointments, this week’s hours, and recent performance.
          </div>
          <div className="ops-table-note">
            {plan.scheduleAvailable ? updatedLabel(plan.scheduleUpdatedAt) : "Waiting for tomorrow’s schedule"}
          </div>
        </div>
        <Link className="ops-call-in-schedule-link" href={`/jobs?date=${plan.targetDate}`}>
          Review tomorrow’s jobs
        </Link>
      </div>

      {!plan.scheduleAvailable ? (
        <div className="ops-call-in-empty">{plan.note}</div>
      ) : (
        <>
          <div className="ops-call-in-summary">
            <div>
              <span>Appointments</span>
              <strong>{plan.appointmentCount}</strong>
            </div>
            <div>
              <span>Coverage target</span>
              <strong>{plan.requiredCrews} crews</strong>
              <small>{plan.requiredHeadcount} people</small>
            </div>
            <div>
              <span>Already assigned</span>
              <strong>{plan.alreadyAssignedHeadcount}</strong>
            </div>
            <div>
              <span>Call in</span>
              <strong>{plan.callInCount}</strong>
              <small>{plan.assumedShiftHours}-hour planning estimate</small>
            </div>
          </div>

          {plan.territoryDemand.length ? (
            <div className="ops-call-in-territories" aria-label="Estimated coverage by territory">
              {plan.territoryDemand.map((territory) => (
                <span key={territory.territory}>
                  <strong>{territory.territory}</strong>
                  {territory.appointments} appointment{territory.appointments === 1 ? "" : "s"} · {territory.crews} crew{territory.crews === 1 ? "" : "s"}
                </span>
              ))}
            </div>
          ) : null}

          {plan.recommendations.length ? (
            <div className="ops-call-in-list">
              {plan.recommendations.map((candidate) => (
                <article className="ops-call-in-person" key={candidate.name}>
                  <div className="ops-call-in-rank">{candidate.rank}</div>
                  <div className="ops-call-in-person-main">
                    <div className="ops-call-in-name-row">
                      <strong>{candidate.name}</strong>
                      <span className={`ops-call-in-role ${candidate.suggestedRole === "Driver" ? "driver" : "crew"}`}>
                        {candidate.suggestedRole}
                      </span>
                      {candidate.overtimeRisk ? <span className="ops-call-in-warning">Overtime risk</span> : null}
                    </div>
                    <p>{candidate.reason}</p>
                  </div>
                  <div className="ops-call-in-person-metrics">
                    <div><span>This week</span><strong>{candidate.weeklyHours.toFixed(1)} hrs</strong></div>
                    <div><span>After call-in</span><strong>{candidate.projectedWeeklyHours.toFixed(1)} hrs</strong></div>
                    <div><span>Recent RPH</span><strong>${Math.round(candidate.recentRph)}</strong></div>
                    <div><span>Jobs</span><strong>{candidate.recentJobs}</strong></div>
                  </div>
                </article>
              ))}
            </div>
          ) : (
            <div className="ops-call-in-empty">
              {plan.callInCount === 0 ? "Tomorrow’s estimated coverage is already filled." : plan.note}
            </div>
          )}

          {plan.alternates.length && plan.callInCount > 0 ? (
            <details className="ops-call-in-alternates">
              <summary>Backups if someone is unavailable</summary>
              <div>
                {plan.alternates.map((candidate) => (
                  <span key={candidate.name}>
                    <strong>{candidate.name}</strong>
                    {candidate.suggestedRole} · {candidate.weeklyHours.toFixed(1)} hrs this week · ${Math.round(candidate.recentRph)} RPH
                  </span>
                ))}
              </div>
            </details>
          ) : null}

          <div className="ops-call-in-note">{plan.note}</div>
        </>
      )}
    </section>
  );
}
