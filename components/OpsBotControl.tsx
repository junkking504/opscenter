import Link from "next/link";
import OpsBotActionConsole from "@/components/OpsBotActionConsole";
import styles from "./OpsBotControl.module.css";

export type OpsBotRecommendation = {
  label: string;
  detail: string;
  status: "watch" | "off-track";
  href: string;
};

type OpsBotControlProps = {
  date: string;
  observedAt?: string | null;
  kernelStatus: "disabled" | "misconfigured" | "ready";
  scheduledJobs: number;
  completedJobs: number;
  unclosedJobs: number;
  activeCrew: number;
  trackedTrucks: number;
  staleTrucks: number;
  unmappedAppointments: number;
  grossRevenue: number;
  dailyRevenuePlan: number;
  laborPercent: number | null;
  recommendations: OpsBotRecommendation[];
};

type LaneTone = "live" | "attention" | "guarded" | "locked";

function money(value: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(Number.isFinite(value) ? value : 0);
}

function shortTimestamp(value?: string | null): string {
  if (!value) return "Waiting for a published observation";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "Observation time unavailable";
  return `Observed ${parsed.toLocaleTimeString("en-US", {
    timeZone: "America/Chicago",
    hour: "numeric",
    minute: "2-digit",
  })} CT`;
}

function ToneDot({ tone }: { tone: LaneTone }) {
  return <i className={`${styles.dot} ${styles[tone]}`} aria-hidden="true" />;
}

export default function OpsBotControl({
  date,
  observedAt,
  kernelStatus,
  scheduledJobs,
  completedJobs,
  unclosedJobs,
  activeCrew,
  trackedTrucks,
  staleTrucks,
  unmappedAppointments,
  grossRevenue,
  dailyRevenuePlan,
  laborPercent,
  recommendations,
}: OpsBotControlProps) {
  const queue = recommendations.length
    ? recommendations
    : [{
        label: "No urgent operating exceptions",
        detail: "OpsBot will keep watching fresh Jobs, Krewe, Fleet, and Finance observations.",
        status: "watch" as const,
        href: `/?date=${date}&section=overview`,
      }];
  const kernelReady = kernelStatus === "ready";
  const revenueProgress = dailyRevenuePlan > 0
    ? Math.max(0, Math.min(100, Math.round((grossRevenue / dailyRevenuePlan) * 100)))
    : 0;

  const sourceLanes: Array<{
    name: string;
    system: string;
    detail: string;
    tone: LaneTone;
    href: string;
  }> = [
    {
      name: "Schedule intelligence",
      system: "JunkWare",
      detail: `${scheduledJobs} scheduled · ${completedJobs} completed · ${unclosedJobs} need follow-up`,
      tone: unclosedJobs > 0 || unmappedAppointments > 0 ? "attention" : "live",
      href: `/jobs?date=${date}`,
    },
    {
      name: "Krewe intelligence",
      system: "OpsCenter",
      detail: `${activeCrew} team member${activeCrew === 1 ? "" : "s"} clocked in or attributed to work`,
      tone: activeCrew > 0 ? "live" : "attention",
      href: `/crew?date=${date}`,
    },
    {
      name: "Fleet intelligence",
      system: "LinxUp",
      detail: `${trackedTrucks} tracked · ${staleTrucks} stale or offline`,
      tone: staleTrucks > 0 || trackedTrucks === 0 ? "attention" : "live",
      href: `/fleet?date=${date}&section=map`,
    },
    {
      name: "Financial intelligence",
      system: "JunkWare + QBO",
      detail: `${money(grossRevenue)} of ${money(dailyRevenuePlan)} plan${laborPercent == null ? " · labor waiting" : ` · ${laborPercent.toFixed(1)}% labor`}`,
      tone: "guarded",
      href: `/finance?date=${date}`,
    },
    {
      name: "Marketing intelligence",
      system: "Podium + JunkWare",
      detail: "Read-only review evidence with governed completed-job and Krewe attribution",
      tone: "guarded",
      href: "/marketing?section=reviews",
    },
  ];

  const autonomyLanes: Array<{
    label: string;
    mode: string;
    detail: string;
    tone: LaneTone;
  }> = [
    {
      label: "Observe",
      mode: "Live",
      detail: "Read approved operational projections and freshness signals.",
      tone: "live",
    },
    {
      label: "Recommend",
      mode: "Live",
      detail: "Rank policy-backed follow-up without changing business state.",
      tone: "live",
    },
    {
      label: "Execute",
      mode: kernelReady ? "Controlled" : "Staged",
      detail: "Only registered actions with identity, policy, and retry protection.",
      tone: "guarded",
    },
    {
      label: "Autonomous",
      mode: "Locked",
      detail: "No autonomous production agent or unrestricted write access.",
      tone: "locked",
    },
  ];

  return (
    <section className={styles.shell} id="opsbot-control" aria-labelledby="opsbot-title">
      <div className={styles.hero}>
        <div className={styles.heroIdentity}>
          <div className={styles.botMark} aria-hidden="true"><span>OB</span></div>
          <div>
            <div className={styles.kicker}><ToneDot tone="live" /> OpsCenter intelligence</div>
            <h2 id="opsbot-title">OpsBot is watching the operation.</h2>
            <p>
              It can surface risk, connect the right evidence, and recommend the next move.
              Production changes remain human-controlled, policy-gated, and verified.
            </p>
          </div>
        </div>

        <div className={styles.authorityCard}>
          <span>Current authority</span>
          <strong>{kernelReady ? "Controlled execution" : "Observe + Recommend"}</strong>
          <div><ToneDot tone="guarded" /> Human approval retained</div>
          <small>{shortTimestamp(observedAt)}</small>
        </div>
      </div>

      <div className={styles.metrics} aria-label="OpsBot control summary">
        <article>
          <span>Signal lanes</span>
          <strong>5</strong>
          <small>Jobs · Krewe · Fleet · Finance · Marketing</small>
        </article>
        <article data-alert={recommendations.length > 0 ? "true" : "false"}>
          <span>Recommendations</span>
          <strong>{recommendations.length}</strong>
          <small>{recommendations.length ? "Current conditions to review" : "No urgent conditions"}</small>
        </article>
        <article>
          <span>Action runtime</span>
          <strong>{kernelReady ? "Live" : "Staged"}</strong>
          <small>{kernelReady ? "Registered commands and audit ledger" : "Kernel activation required"}</small>
        </article>
        <article>
          <span>Autonomous actions</span>
          <strong>0</strong>
          <small>Production autonomy locked</small>
        </article>
      </div>

      <OpsBotActionConsole date={date} enabled={kernelReady} />

      <div className={styles.primaryGrid}>
        <section className={styles.panel} aria-labelledby="opsbot-recommendations">
          <div className={styles.panelHead}>
            <div>
              <span>Decision queue</span>
              <h3 id="opsbot-recommendations">What OpsBot recommends now</h3>
            </div>
            <small>{String(recommendations.length).padStart(2, "0")} active</small>
          </div>
          <div className={styles.queue}>
            {queue.map((item, index) => (
              <Link className={styles.queueItem} href={item.href} key={`${item.label}-${item.href}`}>
                <span className={styles.queueIndex}>{String(index + 1).padStart(2, "0")}</span>
                <span className={styles.queueCopy}>
                  <strong>{item.label}</strong>
                  <small>{item.detail}</small>
                </span>
                <span className={`${styles.priority} ${item.status === "off-track" ? styles.high : styles.medium}`}>
                  {item.status === "off-track" ? "Act now" : "Review"}
                </span>
                <b aria-hidden="true">→</b>
              </Link>
            ))}
          </div>
        </section>

        <section className={`${styles.panel} ${styles.autonomyPanel}`} aria-labelledby="opsbot-autonomy">
          <div className={styles.panelHead}>
            <div>
              <span>Authority controls</span>
              <h3 id="opsbot-autonomy">Autonomy ladder</h3>
            </div>
            <small>Policy first</small>
          </div>
          <div className={styles.autonomyList}>
            {autonomyLanes.map((lane) => (
              <article key={lane.label}>
                <ToneDot tone={lane.tone} />
                <div>
                  <strong>{lane.label}</strong>
                  <p>{lane.detail}</p>
                </div>
                <span className={styles.mode}>{lane.mode}</span>
              </article>
            ))}
          </div>
        </section>
      </div>

      <div className={styles.secondaryGrid}>
        <section className={styles.panel} aria-labelledby="opsbot-sources">
          <div className={styles.panelHead}>
            <div>
              <span>Observation map</span>
              <h3 id="opsbot-sources">What OpsBot can see</h3>
            </div>
            <small>Source authority preserved</small>
          </div>
          <div className={styles.sourceGrid}>
            {sourceLanes.map((lane) => (
              <Link href={lane.href} key={lane.name}>
                <div className={styles.sourceTop}>
                  <ToneDot tone={lane.tone} />
                  <span>{lane.system}</span>
                  <b aria-hidden="true">↗</b>
                </div>
                <strong>{lane.name}</strong>
                <p>{lane.detail}</p>
                {lane.name === "Financial intelligence" ? (
                  <div className={styles.progress} role="progressbar" aria-label="Daily revenue plan progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={revenueProgress}>
                    <i style={{ width: `${revenueProgress}%` }} />
                  </div>
                ) : null}
              </Link>
            ))}
          </div>
        </section>

        <section className={`${styles.panel} ${styles.chainPanel}`} aria-labelledby="opsbot-chain">
          <div className={styles.panelHead}>
            <div>
              <span>Trust architecture</span>
              <h3 id="opsbot-chain">Signal to verified outcome</h3>
            </div>
            <small>{kernelReady ? "Kernel connected" : "Kernel staged"}</small>
          </div>
          <ol className={styles.chain}>
            <li className={styles.complete}><span>01</span><div><strong>Observe</strong><small>Fresh source evidence</small></div></li>
            <li className={styles.complete}><span>02</span><div><strong>Recommend</strong><small>Policy-backed next move</small></div></li>
            <li className={styles.gated}><span>03</span><div><strong>Approve</strong><small>Identity and risk gate</small></div></li>
            <li className={kernelReady ? styles.gated : styles.lockedStep}><span>04</span><div><strong>Execute</strong><small>Registered action only</small></div></li>
            <li className={kernelReady ? styles.gated : styles.lockedStep}><span>05</span><div><strong>Verify</strong><small>Correct authority confirms</small></div></li>
          </ol>
          <div className={styles.kernelState}>
            <ToneDot tone={kernelReady ? "live" : "guarded"} />
            <div>
              <strong>{kernelReady ? "Audit kernel connected" : "Action kernel not enabled"}</strong>
              <small>
                {kernelReady
                  ? "Durable work state, registered executors, verification, and audit are connected."
                  : "This control surface stays read-only without making Command Inbox a prerequisite."}
              </small>
            </div>
          </div>
        </section>
      </div>
    </section>
  );
}
