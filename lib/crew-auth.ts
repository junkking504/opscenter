export const CREW_LOGIN_PATH = "/crew-login";
export const CREW_PAY_PATH = "/my-pay";
export const CREW_IDENTITY_HEADER = "x-ops-crew-email";

export type CrewRosterEntry = {
  employee: string;
  email: string;
  active: boolean;
};

export function normalizeCrewEmail(value: unknown): string {
  const email = String(value || "").trim().toLocaleLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : "";
}
export function crewRoster(): CrewRosterEntry[] {
  const raw = String(process.env.OPS_CREW_ROSTER_JSON || "").trim();
  if (!raw) return [];

  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];

    const roster: CrewRosterEntry[] = [];
    const seenEmails = new Set<string>();
    const seenEmployees = new Set<string>();
    for (const item of parsed) {
      if (!item || typeof item !== "object") continue;
      const row = item as Record<string, unknown>;
      const employee = String(row.employee || "").trim();
      const employeeKey = employee.toLocaleLowerCase();
      const email = normalizeCrewEmail(row.email);
      const active = row.active !== false;
      if (!employee || !email || seenEmails.has(email) || seenEmployees.has(employeeKey)) continue;
      seenEmails.add(email);
      seenEmployees.add(employeeKey);
      roster.push({ employee, email, active });
    }
    return roster;
  } catch {
    return [];
  }
}

export function crewMemberForEmail(email: string): CrewRosterEntry | null {
  const normalized = normalizeCrewEmail(email);
  if (!normalized) return null;
  return crewRoster().find((entry) => entry.active && entry.email === normalized) || null;
}
