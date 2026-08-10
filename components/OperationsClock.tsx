"use client";

import { useEffect, useState } from "react";

function formatTime(date: Date): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Chicago",
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
  }).format(date);
}

function formatDate(date: Date): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Chicago",
    weekday: "short",
    month: "short",
    day: "numeric",
  }).format(date);
}

export default function OperationsClock() {
  const [now, setNow] = useState<Date | null>(null);

  useEffect(() => {
    setNow(new Date());
    const timer = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  if (!now) {
    return (
      <div className="ops-command-clock" aria-label="Central time loading">
        <span className="ops-command-clock-date">Central time</span>
        <time>--:--:--</time>
        <span className="ops-command-clock-zone">CT</span>
      </div>
    );
  }

  return (
    <div className="ops-command-clock" aria-label={`Central time ${formatTime(now)}`}>
      <span className="ops-command-clock-date">{formatDate(now)}</span>
      <time dateTime={now.toISOString()}>{formatTime(now)}</time>
      <span className="ops-command-clock-zone">CT</span>
    </div>
  );
}
