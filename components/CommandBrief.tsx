import Link from "next/link";
import type { ReactNode } from "react";
import type { OperatingStatus } from "@/components/OperatingPulse";
import SlackAlertsDigest from "@/components/SlackAlertsDigest";
import type { SlackDailyDigest } from "@/lib/slack-digest";
import styles from "./CommandBrief.module.css";

export type CommandBriefMetric = {
  label: string;
  value: string;
  detail: string;
  status: OperatingStatus;
  href: string;
  secondaryValue?: string;
  progress?: number;
  progressLabel?: string;
  segments?: Array<{
    label: string;
    value: number;
    status: OperatingStatus;
  }>;
};

export type CommandBriefException = {
  label: string;
  detail: string;
  status: Exclude<OperatingStatus, "on-track">;
  href: string;
};

const statusLabel: Record<OperatingStatus, string> = {
  "on-track": "On Track",
  watch: "Watch",
  "off-track": "Act Now",
};

function toneClass(status: OperatingStatus): string {
  if (status === "on-track") return styles.onTrack;
  if (status === "watch") return styles.watch;
  return styles.offTrack;
}

export default function CommandBrief({
  metrics,
  exceptions,
  date,
  slackDigest,
  map,
}: {
  metrics: CommandBriefMetric[];
  exceptions: CommandBriefException[];
  date: string;
  slackDigest: SlackDailyDigest;
  map: ReactNode;
}) {
  return (
    <section className={styles.brief} id="command-overview" aria-label="Command Overview">
      <div className={styles.metricStrip} aria-label="Headline operating metrics">
        {metrics.map((metric) => (
          <Link
            className={`${styles.metric} ${toneClass(metric.status)} ${metric.segments?.length ? styles.segmentedMetric : ""}`}
            href={metric.href}
            key={metric.label}
          >
            <div>
              <span>{metric.label}</span>
              <i className={styles.metricStatus} aria-label={statusLabel[metric.status]} title={statusLabel[metric.status]} />
            </div>
            <strong>{metric.value}</strong>
            {metric.secondaryValue ? <small className={styles.metricSecondaryValue}>{metric.secondaryValue}</small> : null}
            {metric.segments?.length ? (
              <>
                <ul className={styles.metricBreakdown} aria-label={metric.detail}>
                  {metric.segments.map((segment) => (
                    <li className={toneClass(segment.status)} key={segment.label}>
                      <i aria-hidden="true" />
                      <span>{segment.label}</span>
                      <strong>{segment.value}</strong>
                    </li>
                  ))}
                </ul>
                <div className={styles.metricSegments} role="img" aria-label={metric.detail}>
                  {metric.segments.filter((segment) => segment.value > 0).map((segment) => (
                    <i
                      className={toneClass(segment.status)}
                      key={segment.label}
                      style={{ flexGrow: segment.value }}
                      title={`${segment.label}: ${segment.value}`}
                    />
                  ))}
                </div>
              </>
            ) : <p>{metric.detail}</p>}
            {metric.segments?.length || metric.progress == null ? null : (
              <div
                className={styles.metricProgress}
                role="progressbar"
                aria-label={metric.progressLabel || `${metric.label} progress`}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={Math.min(100, Math.max(0, Math.round(metric.progress)))}
              >
                <i style={{ width: `${Math.min(100, Math.max(0, metric.progress))}%` }} />
              </div>
            )}
          </Link>
        ))}
      </div>

      {exceptions.length ? (
        <section className={styles.exceptionStrip} aria-labelledby="command-exceptions-title">
          <div className={styles.exceptionHeading}>
            <i aria-hidden="true" />
            <strong id="command-exceptions-title">Needs attention</strong>
            <span>{exceptions.length}</span>
          </div>
          <div className={styles.exceptionList}>
            {exceptions.map((exception) => (
              <Link
                className={`${styles.exception} ${toneClass(exception.status)}`}
                href={exception.href}
                key={`${exception.label}-${exception.detail}`}
              >
                <i aria-hidden="true" />
                <span>
                  <strong>{exception.label}</strong>
                  <small>{exception.detail}</small>
                </span>
                <b aria-hidden="true">→</b>
              </Link>
            ))}
          </div>
        </section>
      ) : null}

      <div className={styles.workspace}>
        <SlackAlertsDigest date={date} initialDigest={slackDigest} title="Operations Feed" kicker="Today's alerts" />
        <div className={`${styles.map} ops-jobs-page ops-command-operations-map`}>{map}</div>
      </div>
    </section>
  );
}
