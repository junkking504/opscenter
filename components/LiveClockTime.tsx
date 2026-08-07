"use client";

import { useEffect, useMemo, useState } from "react";

function parseClock(date: string, time: string): Date | null {
  if (!date || !time) return null;

  const match = String(time).trim().match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
  if (!match) return null;

  let hour = Number(match[1]);
  const minute = Number(match[2]);
  const ampm = match[3].toUpperCase();

  if (ampm === "PM" && hour !== 12) hour += 12;
  if (ampm === "AM" && hour === 12) hour = 0;

  const d = new Date(date + "T00:00:00");
  d.setHours(hour, minute, 0, 0);
  return d;
}

function formatElapsed(ms: number): string {
  const safeMs = Math.max(0, ms);
  const totalMinutes = Math.floor(safeMs / 60000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;

  if (hours <= 0) return `${minutes}m`;
  return `${hours}h ${minutes}m`;
}

export default function LiveClockTime({
  date,
  clockIn,
  clockOut,
}: {
  date: string;
  clockIn: string;
  clockOut?: string;
}) {
  const [now, setNow] = useState(() => new Date());

  const isOnClock = Boolean(clockIn) && !clockOut;

  useEffect(() => {
    if (!isOnClock) return;

    const timer = window.setInterval(() => {
      setNow(new Date());
    }, 30000);

    return () => window.clearInterval(timer);
  }, [isOnClock]);

  const label = useMemo(() => {
    const start = parseClock(date, clockIn);
    if (!start) return "—";

    const end = clockOut ? parseClock(date, clockOut) : now;
    if (!end) return "—";

    return formatElapsed(end.getTime() - start.getTime());
  }, [date, clockIn, clockOut, now]);

  return <span>{label}</span>;
}
