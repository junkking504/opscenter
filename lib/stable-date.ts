const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function stableUpdatedAt(value?: string | null): string {
  if (!value) return "";

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);

  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Chicago",
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).formatToParts(date);

  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";

  const monthNumber = Number(get("month"));
  const month = MONTHS[Math.max(0, monthNumber - 1)] ?? get("month");
  const day = String(Number(get("day")));
  const hour = String(Number(get("hour")));
  const minute = get("minute");
  const dayPeriod = get("dayPeriod");

  return `${month} ${day}, ${hour}:${minute} ${dayPeriod}`;
}
