"use client";

import { useEffect, useState } from "react";
import type { SlackDailyDigest } from "@/lib/slack-digest";
import styles from "./CommandBrief.module.css";

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
    const refresh = async () => {
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
      }
    };
    const interval = window.setInterval(refresh, 60_000);
    return () => {
      active = false;
      window.clearInterval(interval);
    };
  }, [date]);

  return (
    <section className={styles.queue} aria-labelledby="slack-alerts-title">
      <div className={styles.sectionHeader}>
        <div>
          <span>Daily Digest</span>
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
        <div className={styles.digestList} aria-label="Slack messages, newest first">
          {digest.messages.map((message) => (
            <article className={styles.digestMessage} key={message.id}>
              <time dateTime={message.timestamp}>{messageTime(message.timestamp)}</time>
              <div>
                <strong>{message.author}{message.threadReply ? " · Reply" : ""}</strong>
                <p>{message.text}</p>
              </div>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
