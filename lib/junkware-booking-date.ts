const BOOKED_AT_KEYS = ["booked_at", "bookedAt", "booked"] as const;

type BookingDateParts = {
  year: number;
  month: number;
  day: number;
};

function validDateParts(year: number, month: number, day: number): BookingDateParts | null {
  const date = new Date(Date.UTC(year, month - 1, day, 12));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null;
  }
  return { year, month, day };
}

function bookingDateParts(value: unknown): BookingDateParts | null {
  const raw = String(value ?? "").trim();
  if (!raw) return null;

  const junkwareMatch = raw.match(/(?:^|\b)(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\b|$)/);
  if (junkwareMatch) {
    return validDateParts(
      Number(junkwareMatch[3]),
      Number(junkwareMatch[1]),
      Number(junkwareMatch[2]),
    );
  }

  const isoMatch = raw.match(/(?:^|\b)(\d{4})-(\d{2})-(\d{2})(?=$|[T\s,])/);
  if (isoMatch) {
    return validDateParts(
      Number(isoMatch[1]),
      Number(isoMatch[2]),
      Number(isoMatch[3]),
    );
  }

  return null;
}

export function junkwareBookedAt(...rows: Array<Record<string, unknown> | null | undefined>): string {
  for (const row of rows) {
    if (!row) continue;
    for (const key of BOOKED_AT_KEYS) {
      const value = String(row[key] ?? "").trim();
      if (value && bookingDateParts(value)) return value;
    }
  }
  return "";
}

export function junkwareBookedDateLabel(value: unknown): string {
  const parts = bookingDateParts(value);
  if (!parts) return "";

  return new Intl.DateTimeFormat("en-US", {
    timeZone: "UTC",
    weekday: "short",
    month: "short",
    day: "numeric",
  }).format(new Date(Date.UTC(parts.year, parts.month - 1, parts.day, 12)));
}
