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
  if (!value) return "Waiting for the latest update";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "Update time unavailable";
  return `Updated ${parsed.toLocaleTimeString("en-US", {
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
        label: "Nothing urgent needs your attention",
        detail: "OpsBot is still watching Jobs, Krewe, Fleet, and Finance.",
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
      name: "Systems",
      system: "OpsCenter status",
      detail: "See what is working, what is delayed, and who owns the next step",
      tone: kernelReady ? "guarded" : "attention",
      href: `/?date=${date}&section=opsbot#opsbot-systems-title`,
    },
    {
      name: "Jobs & schedule",
      system: "JunkWare",
      detail: `${scheduledJobs} scheduled · ${completedJobs} completed · ${unclosedJobs} need follow-up`,
      tone: unclosedJobs > 0 || unmappedAppointments > 0 ? "attention" : "live",
      href: `/jobs?date=${date}`,
    },
    {
      name: "Krewe",
      system: "OpsCenter",
      detail: `${activeCrew} team member${activeCrew === 1 ? "" : "s"} clocked in or attributed to work`,
      tone: activeCrew > 0 ? "live" : "attention",
      href: `/crew?date=${date}`,
    },
    {
      name: "Trucks & GPS",
      system: "LinxUp",
      detail: `${trackedTrucks} tracked · ${staleTrucks} stale or offline`,
      tone: staleTrucks > 0 || trackedTrucks === 0 ? "attention" : "live",
      href: `/fleet?date=${date}&section=map`,
    },
    {
      name: "Money",
      system: "JunkWare + QBO",
      detail: `${money(grossRevenue)} of ${money(dailyRevenuePlan)} plan${laborPercent == null ? " · labor waiting" : ` · ${laborPercent.toFixed(1)}% labor`}`,
      tone: "guarded",
      href: `/finance?date=${date}`,
    },
    {
      name: "Reviews & leads",
      system: "Podium + SearchKings + JunkWare",
      detail: "Match reviews to completed jobs and follow up on missed leads",
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
      label: "Watch the operation",
      mode: "On",
      detail: "Reads the latest information from each connected system.",
      tone: "live",
    },
    {
      label: "Suggest next steps",
      mode: "On",
      detail: "Shows what needs attention without changing anything.",
      tone: "live",
    },
    {
      label: "Make changes",
      mode: kernelReady ? "With safeguards" : "View only",
      detail: "Records who clicked, asks for approval when needed, and checks the result.",
      tone: "guarded",
    },
    {
      label: "Act without a person",
      mode: "Off",
      detail: "OpsBot cannot make production changes on its own.",
      tone: "locked",
    },
  ];

  return (
    <section className={styles.shell} id="opsbot-control" aria-labelledby="opsbot-title">
      <div className={styles.hero}>
        <div className={styles.heroIdentity}>
          <div className={styles.botMark} aria-hidden="true"><span>OB</span></div>
          <div>
            <div className={styles.kicker}><ToneDot tone="live" /> OpsBot AI Dashboard</div>
            <h2 id="opsbot-title">See what needs attention and take the next step.</h2>
            <p>
              OpsBot brings Jobs, Krewe, Fleet, Finance, Systems, and Marketing into one place.
              Bigger changes wait for another manager before anything happens.
            </p>
          </div>
        </div>

        <div className={styles.authorityCard}>
          <span>What buttons can do</span>
          <strong>{kernelReady ? "Changes are enabled" : "View and suggest only"}</strong>
          <div><ToneDot tone="guarded" /> Manager approval for bigger changes</div>
          <small>{shortTimestamp(observedAt)}</small>
        </div>
      </div>

      <div className={styles.metrics} aria-label="OpsBot control summary">
        <article>
          <span>Areas watched</span>
          <strong>6</strong>
          <small>Systems · Jobs · Krewe · Fleet · Finance · Marketing</small>
        </article>
        <article data-alert={recommendations.length > 0 ? "true" : "false"}>
          <span>Needs attention</span>
          <strong>{recommendations.length}</strong>
          <small>{recommendations.length ? "Items to review now" : "Nothing urgent"}</small>
        </article>
        <article>
          <span>Safe actions</span>
          <strong>{kernelReady ? "Ready" : "View only"}</strong>
          <small>{kernelReady ? "Every change is recorded and checked" : "Changes are not enabled here"}</small>
        </article>
        <article>
          <span>Changes without a person</span>
          <strong>0</strong>
          <small>OpsBot cannot act on its own</small>
        </article>
      </div>

      <OpsBotActionConsole date={date} enabled={kernelReady} />

      <div className={styles.primaryGrid}>
        <section className={styles.panel} aria-labelledby="opsbot-recommendations">
          <div className={styles.panelHead}>
            <div>
              <span>Your priority list</span>
              <h3 id="opsbot-recommendations">What needs your attention</h3>
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
              <span>What OpsBot is allowed to do</span>
              <h3 id="opsbot-autonomy">You stay in control</h3>
            </div>
            <small>People approve important changes</small>
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
              <span>Connected systems</span>
              <h3 id="opsbot-sources">Where the information comes from</h3>
            </div>
            <small>Open any area for details</small>
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
                {lane.name === "Money" ? (
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
              <span>Before anything changes</span>
              <h3 id="opsbot-chain">What happens after you click</h3>
            </div>
            <small>{kernelReady ? "Actions are ready" : "View only"}</small>
          </div>
          <ol className={styles.chain}>
            <li className={styles.complete}><span>01</span><div><strong>Check current info</strong><small>Use the latest connected data</small></div></li>
            <li className={styles.complete}><span>02</span><div><strong>Show the next step</strong><small>Explain what needs attention</small></div></li>
            <li className={styles.gated}><span>03</span><div><strong>Get approval if needed</strong><small>Another manager reviews bigger changes</small></div></li>
            <li className={kernelReady ? styles.gated : styles.lockedStep}><span>04</span><div><strong>Make the change</strong><small>Only the action you selected</small></div></li>
            <li className={kernelReady ? styles.gated : styles.lockedStep}><span>05</span><div><strong>Check that it worked</strong><small>Confirm the saved result</small></div></li>
          </ol>
          <div className={styles.kernelState}>
            <ToneDot tone={kernelReady ? "live" : "guarded"} />
            <div>
              <strong>{kernelReady ? "Actions and history are ready" : "Actions are view-only"}</strong>
              <small>
                {kernelReady
                  ? "OpsCenter records who made each request, whether it was approved, and whether it worked."
                  : "You can still see the operation and recommended next steps, but buttons will not change shared data."}
              </small>
            </div>
          </div>
        </section>
      </div>
    </section>
  );
}
