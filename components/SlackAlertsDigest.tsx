"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type { SlackDailyDigest } from "@/lib/slack-digest";
import styles from "./CommandBrief.module.css";

const POLL_INTERVAL_MS = 15_000;

function messageTime(timestamp: string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Chicago",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(timestamp));
}

export default function SlackAlertsDigest({
  date,
  initialDigest,
}: {
  date: string;
  initialDigest: SlackDailyDigest;
}) {
  const [digest, setDigest] = useState(initialDigest);

  useEffect(() => {
    setDigest(initialDigest);
  }, [initialDigest]);

  useEffect(() => {
    let active = true;
    let refreshInFlight = false;
    const refresh = async () => {
      if (refreshInFlight) return;
      refreshInFlight = true;
      try {
        const response = await fetch(`/api/slack/digest?date=${encodeURIComponent(date)}`, {
          cache: "no-store",
          credentials: "same-origin",
        });
        if (!response.ok) return;
        const next = await response.json() as SlackDailyDigest;
        if (active) setDigest(next);
      } catch {
        // Keep the last successful digest visible during a transient refresh failure.
      } finally {
        refreshInFlight = false;
      }
    };
    const refreshWhenVisible = () => {
      if (document.visibilityState === "visible") void refresh();
    };

    void refresh();
    const interval = window.setInterval(() => void refresh(), POLL_INTERVAL_MS);
    window.addEventListener("focus", refreshWhenVisible);
    document.addEventListener("visibilitychange", refreshWhenVisible);

    return () => {
      active = false;
      window.clearInterval(interval);
      window.removeEventListener("focus", refreshWhenVisible);
      document.removeEventListener("visibilitychange", refreshWhenVisible);
    };
  }, [date]);

  return (
    <section className={styles.queue} aria-labelledby="slack-alerts-title">
      <div className={styles.sectionHeader}>
        <div>
          <span>Command Awareness</span>
          <h2 id="slack-alerts-title">Slack Alerts</h2>
        </div>
        <small>{String(digest.messages.length).padStart(2, "0")} messages</small>
      </div>

      {digest.status === "unavailable" ? (
        <div className={styles.digestState} role="status">
          <strong>Slack alerts are unavailable</strong>
          <span>{digest.detail || "OpsCenter could not refresh the digest."}</span>
        </div>
      ) : digest.messages.length === 0 ? (
        <div className={styles.digestState} role="status">
          <strong>No Slack alerts yet</strong>
          <span>New messages for this day will appear here automatically.</span>
        </div>
      ) : (
        <div className={styles.digestList} aria-label="Slack messages, newest first" aria-live="polite">
          {digest.messages.map((message) => (
            <article className={styles.digestMessage} key={message.id}>
              <time dateTime={message.timestamp}>{messageTime(message.timestamp)}</time>
              <div>
                <strong className={styles.digestChannel}>
                  {message.channel}{message.threadReply ? " · Reply" : ""}
                </strong>
                {message.appointment ? (
                  <div className={styles.digestAppointment}>
                    <p className={styles.digestAppointmentTitle}>
                      <span aria-hidden="true">⚠️</span>{" "}
                      {message.appointment.title}:{" "}
                      <Link href={message.appointment.href}>{message.appointment.jobNumber}</Link>
                    </p>
                    <p>
                      {message.appointment.customerName} · {message.appointment.phone} · {message.appointment.appointmentTime}
                    </p>
                    <p>{message.appointment.address}</p>
                    {message.appointment.items.length ? (
                      <p>Items: {message.appointment.items.join("; ")}</p>
                    ) : null}
                    {message.appointment.nextAction ? (
                      <p className={styles.digestNext}>Next: {message.appointment.nextAction}</p>
                    ) : null}
                    <Link className={styles.digestOpenLink} href={message.appointment.href}>
                      Open in OpsCenter
                    </Link>
                  </div>
                ) : message.closeout ? (
                  <div className={styles.digestAppointment}>
                    <p className={styles.digestAppointmentTitle}>
                      <span aria-hidden="true">✅</span>{" "}
                      <Link href={message.closeout.href}>{message.closeout.jobNumber}</Link> closed out.
                    </p>
                    {message.closeout.lines.map((line) => <p key={line}>{line}</p>)}
                    <Link className={styles.digestOpenLink} href={message.closeout.href}>
                      Open in OpsCenter
                    </Link>
                  </div>
                ) : (
                  <>
                    <p>{message.text}</p>
                    {message.opsCenterHref ? (
                      <Link className={styles.digestOpenLink} href={message.opsCenterHref}>
                        Open in OpsCenter
                      </Link>
                    ) : null}
                  </>
                )}
              </div>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
