"use client";

import Link from "next/link";
import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  type CommandChangeCategory,
  summarizeCommandChanges,
} from "@/lib/command-change-digest";
import type { SlackDailyDigest } from "@/lib/slack-digest";
import styles from "./CommandBrief.module.css";

const POLL_INTERVAL_MS = 15_000;
const CHANGE_FILTERS: Array<{
  category: CommandChangeCategory;
  label: string;
  detail: string;
}> = [
  { category: "new-job", label: "New jobs", detail: "Appointments added" },
  { category: "exception", label: "New exceptions", detail: "Changes needing review" },
  { category: "completed", label: "Completed work", detail: "Closures and resolutions" },
];

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
  moneybag: "💰",
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
  title = "Slack Alerts",
  kicker = "Command Awareness",
  limit,
}: {
  date: string;
  initialDigest: SlackDailyDigest;
  title?: string;
  kicker?: string;
  limit?: number;
}) {
  const [digest, setDigest] = useState(initialDigest);
  const [lastLookedAt, setLastLookedAt] = useState<string | null>(null);
  const [changeFilter, setChangeFilter] = useState<CommandChangeCategory | "all">("all");
  const [changeStateReady, setChangeStateReady] = useState(false);
  const initializedStorageKey = useRef("");
  const storageKey = useMemo(
    () => `opscenter:command:last-looked:v1:${encodeURIComponent(date)}`,
    [date],
  );
  const changeSummary = useMemo(
    () => summarizeCommandChanges(digest.messages, lastLookedAt),
    [digest.messages, lastLookedAt],
  );
  const changedMessages = useMemo(
    () => new Set(Object.values(changeSummary).flat().map((message) => message.id)),
    [changeSummary],
  );
  const filteredMessages = changeFilter === "all"
    ? digest.messages
    : changeSummary[changeFilter];
  const visibleMessages = typeof limit === "number"
    ? filteredMessages.slice(0, limit)
    : filteredMessages;
  const totalChanges = changedMessages.size;

  const saveLastLookedAt = useCallback((timestamp: string) => {
    try {
      window.localStorage.setItem(storageKey, timestamp);
    } catch {
      // Keep the digest useful in memory if browser storage is unavailable.
    }
  }, [storageKey]);

  function markReviewed() {
    const timestamp = new Date().toISOString();
    saveLastLookedAt(timestamp);
    setLastLookedAt(timestamp);
    setChangeFilter("all");
  }

  function baselineLabel(): string {
    if (!lastLookedAt) return "Today so far on this browser";
    return `Since ${new Intl.DateTimeFormat("en-US", {
      timeZone: "America/Chicago",
      hour: "numeric",
      minute: "2-digit",
    }).format(new Date(lastLookedAt))}`;
  }

  useEffect(() => {
    setDigest(initialDigest);
  }, [initialDigest]);

  useEffect(() => {
    if (initializedStorageKey.current === storageKey) return;
    initializedStorageKey.current = storageKey;
    let stored: string | null = null;
    try {
      const candidate = window.localStorage.getItem(storageKey);
      stored = candidate && Number.isFinite(Date.parse(candidate)) ? candidate : null;
    } catch {
      stored = null;
    }
    setLastLookedAt(stored);
    setChangeFilter("all");
    setChangeStateReady(true);
    saveLastLookedAt(new Date().toISOString());
  }, [saveLastLookedAt, storageKey]);

  useEffect(() => {
    const recordDeparture = () => saveLastLookedAt(new Date().toISOString());
    const recordWhenHidden = () => {
      if (document.visibilityState === "hidden") recordDeparture();
    };
    window.addEventListener("pagehide", recordDeparture);
    document.addEventListener("visibilitychange", recordWhenHidden);
    return () => {
      window.removeEventListener("pagehide", recordDeparture);
      document.removeEventListener("visibilitychange", recordWhenHidden);
    };
  }, [saveLastLookedAt]);

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
          <span>{kicker}</span>
          <h2 id="slack-alerts-title">{title}</h2>
        </div>
        <small>
          {String(digest.messages.length).padStart(2, "0")} alerts
          {changeStateReady ? ` · ${totalChanges} new` : ""}
          {digest.filteredSystemMessages ? ` · ${digest.filteredSystemMessages} system hidden` : ""}
        </small>
      </div>

      <section className={styles.changeDigest} aria-labelledby="command-changes-title">
        <div className={styles.changeDigestHeading}>
          <div>
            <span>Since last visit</span>
            <strong id="command-changes-title">
              {changeStateReady ? baselineLabel() : "Checking recent changes…"}
            </strong>
          </div>
          {changeStateReady && totalChanges > 0 ? (
            <button type="button" onClick={markReviewed}>Mark reviewed</button>
          ) : null}
        </div>
        <div className={styles.changeMetrics} aria-label="Command changes by type">
          {CHANGE_FILTERS.map(({ category, label, detail }) => {
            const count = changeStateReady ? changeSummary[category].length : 0;
            return (
              <button
                className={changeFilter === category ? styles.activeChangeMetric : undefined}
                type="button"
                aria-pressed={changeFilter === category}
                aria-label={`${label}: ${count}. ${detail}`}
                disabled={!changeStateReady || count === 0}
                onClick={() => setChangeFilter((current) => current === category ? "all" : category)}
                key={category}
              >
                <strong>{count}</strong>
                <span>{label}</span>
                <small>{detail}</small>
              </button>
            );
          })}
        </div>
        {changeFilter !== "all" ? (
          <button className={styles.showAllChanges} type="button" onClick={() => setChangeFilter("all")}>
            Show all alerts
          </button>
        ) : null}
      </section>

      {digest.status === "unavailable" ? (
        <div className={styles.digestState} role="status">
          <strong>Slack alerts are unavailable</strong>
          <span>{digest.detail || "OpsCenter could not refresh the digest."}</span>
        </div>
      ) : filteredMessages.length === 0 ? (
        <div className={styles.digestState} role="status">
          <strong>{changeFilter === "all" ? "No Slack alerts yet" : "No matching changes"}</strong>
          <span>{changeFilter === "all" ? "New messages for this day will appear here automatically." : "Choose another change type or show all alerts."}</span>
        </div>
      ) : (
        <div className={styles.digestList} aria-label="Slack messages, newest first" aria-live="polite">
          {visibleMessages.map((message) => (
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
