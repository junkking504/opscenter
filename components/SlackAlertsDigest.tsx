"use client";

import Link from "next/link";
import { type ReactNode, useEffect, useState } from "react";
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

const SLACK_EMOJI: Record<string, string> = {
  rotating_light: "🚨",
  warning: "⚠️",
  x: "❌",
  white_check_mark: "✅",
  truck: "🚚",
  camera_with_flash: "📸",
  wastebasket: "🗑️",
  fuelpump: "⛽",
};

function decodeSlackText(value: string): string {
  return String(value || "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/:([a-z0-9_+-]+):/gi, (match, name: string) => SLACK_EMOJI[name] || match);
}

function hrefForOpsCenter(url: string): string | null {
  try {
    const parsed = new URL(url);
    return parsed.hostname === "ops.junk-king.app"
      ? `${parsed.pathname}${parsed.search}${parsed.hash}`
      : null;
  } catch {
    return null;
  }
}

function renderSlackLink(url: string, label: string, key: string): ReactNode {
  const internalHref = hrefForOpsCenter(url);
  if (internalHref) return <Link href={internalHref} key={key}>{label}</Link>;
  return <a href={url} key={key} target={url.startsWith("http") ? "_blank" : undefined} rel={url.startsWith("http") ? "noreferrer" : undefined}>{label}</a>;
}

function renderSlackInline(value: string): ReactNode[] {
  const source = decodeSlackText(value);
  const tokens: ReactNode[] = [];
  const pattern = /\*<(https?:\/\/[^>|]+|tel:[^>|]+)\|([^>]+)>\*|<(https?:\/\/[^>|]+|tel:[^>|]+)\|([^>]+)>|<(https?:\/\/[^>]+)>|\*([^*\n]+)\*|_([^_\n]+)_/g;
  let offset = 0;
  let match: RegExpExecArray | null;
  let index = 0;

  while ((match = pattern.exec(source))) {
    if (match.index > offset) tokens.push(source.slice(offset, match.index));
    const key = `token-${index++}`;
    if (match[1]) {
      tokens.push(<strong key={key}>{renderSlackLink(match[1], match[2], `${key}-link`)}</strong>);
    } else if (match[3]) {
      tokens.push(renderSlackLink(match[3], match[4], key));
    } else if (match[5]) {
      tokens.push(renderSlackLink(match[5], match[5], key));
    } else if (match[6]) {
      tokens.push(<strong key={key}>{match[6]}</strong>);
    } else if (match[7]) {
      tokens.push(<em key={key}>{match[7]}</em>);
    }
    offset = pattern.lastIndex;
  }
  if (offset < source.length) tokens.push(source.slice(offset));
  return tokens;
}

function slackDisplayLines(rawText: string): string[] {
  return String(rawText || "")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line && !/^_?Alert ID:/i.test(line));
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
                <div className={styles.digestSlackMessage}>
                  {slackDisplayLines(message.rawText).map((line, index) => (
                    <p key={`${message.id}-${index}`}>{renderSlackInline(line)}</p>
                  ))}
                </div>
              </div>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
