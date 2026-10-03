import { readDesktopKrewe } from './desktop-krewe';
import { opsRoleCan, type InteractiveOpsRole } from './ops-roles';
import { chicagoDateKey } from './report-dates';

/** Identity map is supplied by the request and never serialized to the provider. */
export function readOpsBotEmployeeMetrics(
  throughDate: string, role: InteractiveOpsRole, identities: Map<string, { token: string; name: string }>,
  read: typeof readDesktopKrewe = readDesktopKrewe,
) {
  if (!opsRoleCan(role, 'sensitive.write')) throw new Error('Manager access required.');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(throughDate) || !Number.isFinite(Date.parse(`${throughDate}T12:00:00Z`))
    || new Date(`${throughDate}T12:00:00Z`).toISOString().slice(0,10) !== throughDate || throughDate > chicagoDateKey()) throw new Error('A valid historical or current through-date is required.');
  const snapshot = read(throughDate, 'monthly', role);
  const observed = (value: number | null): value is number => value !== null && Number.isFinite(value);
  const employees = snapshot.members.slice(0,80).map(member => {
    let identity = identities.get(member.id);
    if (!identity) {
      identity = { token: `EMPLOYEE_REF_${identities.size + 1}`, name: member.name };
      identities.set(member.id, identity);
    }
    const complete = (field: 'revenue'|'hours'|'jobs') => member.days.length > 0 && member.days.every(day => observed(day[field]));
    const rate = complete('revenue') && complete('hours') && observed(member.revenue) && observed(member.hours) && member.hours > 0
      && member.days.every(day => day.hours! >= 0 && !(day.revenue! > 0 && day.hours === 0)) ? Math.round(member.revenue/member.hours*100)/100 : null;
    return {
      employee: identity.token, creditedRevenue: member.revenue, jobCredits: member.jobs, recordedHours: member.hours,
      creditedRevenuePerRecordedHour: rate, observedEmployeeDays: member.days.length,
      missingRevenueDays: member.days.filter(day => !observed(day.revenue)).length,
      missingJobCreditDays: member.days.filter(day => !observed(day.jobs)).length,
      missingHoursDays: member.days.filter(day => !observed(day.hours)).length,
    };
  });
  return {
    output: { start: snapshot.start, end: snapshot.end, sourceUpdatedAt: snapshot.sourceUpdatedAt, missingDates: snapshot.missingDates,
      employees, totalEmployees: snapshot.members.length, truncated: employees.length < snapshot.members.length,
      interpretation: 'Observed attributed production, not profit or a validated overall score. Job credits can be shared. Missing dates/components make comparisons provisional. Hours and assignments affect totals. Do not score safety, quality, attendance, or other unavailable dimensions. Employee presence/absence on a day is not independently verified. Return employee reference tokens verbatim; the server resolves identities for the authenticated manager.' },
    sources: [{ label: 'Crew monthly metrics', detail: `${snapshot.start}–${snapshot.end} · period-end source timestamp: ${snapshot.sourceUpdatedAt || 'unavailable'}`, href: `/desktop?data=live&workspace=Krewe&kreweView=monthly&date=${throughDate}` }],
  };
}

export function resolveEmployeeReferences(answer: string, identities: Map<string,{token:string;name:string}>): string {
  const names = new Map([...identities.values()].map(identity => [identity.token, identity.name.replace(/[\[\]()*_`<>#|\\\r\n]/g,' ').trim()]));
  return answer.replace(/\bEMPLOYEE_REF_\d+\b/g, token => names.get(token) || 'Unverified employee reference');
}
