/**
 * The one canonical America/Chicago date-key logic for OpsCenter.
 *
 * Previously this exact logic was reimplemented independently in 5 places
 * across the app (see the 2026-08-21 data-consistency audit) — the same
 * class of bug documented as a real past incident (the June date-collection
 * bug in OPSCENTER_MEMORY.md). This file has zero imports on purpose — it
 * must stay safe to import from both server code and "use client"
 * components without pulling `fs`/`path` into the browser bundle.
 */

function pad(value: number) {
  return String(value).padStart(2, "0");
}

export function chicagoDateKey(reference: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Chicago",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(reference);
}

export function addDays(dateKey: string, days: number): string {
  const date = new Date(`${dateKey}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;
}
