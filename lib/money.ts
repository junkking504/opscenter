/**
 * The one canonical USD currency formatter for OpsCenter.
 *
 * Previously this exact logic was reimplemented independently in 14 places
 * across the app (see the 2026-08-21 data-consistency audit). This file has
 * zero imports on purpose — it must stay safe to import from both server
 * code and "use client" components without pulling `fs`/`path` into the
 * browser bundle.
 */
export function money(value: unknown): string {
  const n = Number(value || 0);
  return n.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}
