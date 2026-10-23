import type { DesktopCrewMember } from './people-fleet-contract';

type RphMember = Pick<DesktopCrewMember, 'hours' | 'revenue' | 'clockInAt'>;
// The desktop Crew calculation is credited revenue / worked hours. Never use
// roster membership, an hourly rate, or another day's shift as worked hours.
export function employeeRph(member: RphMember): number | null {
  if (member.clockInAt == null || !Number.isFinite(member.clockInAt) ||
      member.hours == null || !Number.isFinite(member.hours) || member.hours <= 0 ||
      member.revenue == null || !Number.isFinite(member.revenue)) return null;
  const value = member.revenue / member.hours;
  return Number.isFinite(value) ? value : null;
}

export function crewRph(snapshot: { members: RphMember[]; missingDates: string[] } | null) {
  const members = snapshot?.members || [];
  const eligible = members.filter(member => employeeRph(member) !== null);
  const hours = eligible.reduce((sum, member) => sum + member.hours!, 0);
  const revenue = eligible.reduce((sum, member) => sum + member.revenue!, 0);
  // Missing revenue for a worked shift makes the aggregate unsupported.
  const missingRevenue = members.some(member => member.clockInAt != null && Number.isFinite(member.clockInAt) &&
    member.hours != null && Number.isFinite(member.hours) && member.hours > 0 &&
    (member.revenue == null || !Number.isFinite(member.revenue)));
  const value = !snapshot || snapshot.missingDates.length || missingRevenue || hours <= 0 ? null : revenue / hours;
  return { value: value != null && Number.isFinite(value) ? value : null, hours, revenue,
    included: eligible.length, excluded: members.length - eligible.length };
}

/** Recompute the same ratio from eligible days inside the displayed period. */
export function rphForDays(days: DesktopCrewMember['days'], start: string, end: string, missingDates: string[] = []) {
  return crewRph({ members: days.filter(day => day.date >= start && day.date <= end),
    missingDates: missingDates.filter(date => date >= start && date <= end) }).value;
}
