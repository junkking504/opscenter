"use client";

import { useEffect, useRef, useState } from "react";

type TextUpdate = {
  sequence: number;
  receivedAt: string;
  sender: string;
  text: string;
  kind: "new-appointment" | "cancellation" | "appointment-change" | "unknown";
  appointmentDates: string[];
};

type TextFeed = {
  ok: boolean;
  sequence: number;
  updatedAt: string | null;
  messages: TextUpdate[];
};

const POLL_INTERVAL_MS = 5_000;

function timeLabel(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Just now";
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Chicago",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

function kindLabel(kind: TextUpdate["kind"]): string {
  if (kind === "new-appointment") return "New appointment";
  if (kind === "cancellation") return "Cancellation";
  if (kind === "appointment-change") return "Appointment changed";
  return "Junk King text";
}

export default function JunkwareTextUpdates() {
  const [feed, setFeed] = useState<TextFeed | null>(null);
  const [available, setAvailable] = useState(true);
  const pollingRef = useRef(false);
  const sequenceRef = useRef(-1);

  useEffect(() => {
    let active = true;

    async function refresh() {
      if (pollingRef.current) return;
      pollingRef.current = true;
      try {
        const response = await fetch("/api/integrations/junkware/sms/feed", { cache: "no-store" });
        const payload = await response.json().catch(() => null) as TextFeed | null;
        if (!response.ok || !payload?.ok || !Array.isArray(payload.messages)) throw new Error("feed unavailable");
        if (!active) return;
        if (payload.sequence !== sequenceRef.current) {
          sequenceRef.current = payload.sequence;
          setFeed(payload);
        }
        setAvailable(true);
      } catch {
        if (active) setAvailable(false);
      } finally {
        pollingRef.current = false;
      }
    }

    void refresh();
    const interval = window.setInterval(() => void refresh(), POLL_INTERVAL_MS);
    const handleVisible = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    document.addEventListener("visibilitychange", handleVisible);
    return () => {
      active = false;
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", handleVisible);
    };
  }, []);

  const messages = feed?.messages.slice(0, 3) || [];

  if (!messages.length) {
    return (
      <section
        className={`ops-text-updates ops-text-updates-compact${available ? "" : " is-unavailable"}`}
        aria-live="polite"
        aria-label="Live Junk King text updates"
      >
        <div className="ops-text-updates-header">
          <div>
            <span className={`ops-text-updates-status${available ? "" : " unavailable"}`} />
            <strong>Live text updates</strong>
          </div>
          <span>{available ? "No new messages" : "Reconnecting…"}</span>
        </div>
      </section>
    );
  }

  return (
    <section className="ops-text-updates" aria-live="polite" aria-label="Live Junk King text updates">
      <div className="ops-text-updates-header">
        <div>
          <span className={`ops-text-updates-status${available ? "" : " unavailable"}`} />
          <strong>Live text updates</strong>
        </div>
        <span>{available ? "Checking every 5 seconds" : "Reconnecting…"}</span>
      </div>
      <div className="ops-text-updates-list">
        {messages.map((message, index) => (
          <article className={`ops-text-update${index === 0 ? " latest" : ""}`} key={message.sequence}>
            <div className="ops-text-update-meta">
              <span>{kindLabel(message.kind)}</span>
              <time dateTime={message.receivedAt}>{timeLabel(message.receivedAt)}</time>
            </div>
            <p>{message.text}</p>
            <small>{message.sender || "Junk King"}{message.appointmentDates.length ? ` · ${message.appointmentDates.join(", ")}` : ""}</small>
          </article>
        ))}
      </div>
    </section>
  );
}
