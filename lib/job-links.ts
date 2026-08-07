export function appointmentAnchor(reference: string): string {
  const slug = String(reference || "")
    .replace(/[^a-z0-9]+/gi, "-")
    .replace(/^-|-$/g, "")
    .toLowerCase();
  return slug ? `job-${slug}` : "";
}

export function appointmentScheduleHref(date: string, reference: string): string {
  const href = `/jobs?date=${encodeURIComponent(date)}`;
  const anchor = appointmentAnchor(reference);
  return anchor ? `${href}#${anchor}` : href;
}
