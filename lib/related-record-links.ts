function slug(value: string): string {
  return String(value || "")
    .trim()
    .toLocaleLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function truckNumber(value: string): string {
  const match = String(value || "").match(/(\d+)/);
  return match ? match[1] : String(value || "").trim();
}

export function crewMemberAnchor(name: string): string {
  return `crew-member-${slug(name) || "unknown"}`;
}

export function crewMemberHref(date: string, name: string): string {
  const params = new URLSearchParams({ date, section: "crew", member: name });
  return `/crew?${params.toString()}#${crewMemberAnchor(name)}`;
}

export function fleetTruckHref(date: string, truck: string): string {
  const params = new URLSearchParams({
    date,
    view: "daily",
    section: "map",
    truck: truckNumber(truck),
  });
  return `/fleet?${params.toString()}`;
}

export function jobScheduleAnchor(jkNumber: string): string {
  return `job-${slug(jkNumber) || "unknown"}`;
}

export function jobScheduleHref(date: string, jkNumber: string, appointmentId?: string): string {
  const params = new URLSearchParams({ date, q: jkNumber });
  if (appointmentId) params.set('appointment', appointmentId);
  return `/jobs?${params.toString()}#${jobScheduleAnchor(jkNumber)}`;
}
