import { readMetrics, type AnyRecord } from './opsData';
import { readJobRows, junkwareScheduleUpdatedAt } from './desktop-schedule-source';
import { applyPayrollCorrectionsToCrewMetrics } from './crew-portal-publication';
import { periodFromMetrics, payPeriodForDate } from './crew-pay-portal';
import { chicagoDateKey, addDays } from './report-dates';
import { opsRoleCan, type InteractiveOpsRole } from './ops-roles';
import type { LocalCrewRevenueAnswer } from './local-crew-revenue-answer';
import { readSavedCallInDecisions } from './desktop-krewe';

export type LocalLookupReaders = {
  metrics: typeof readMetrics;
  jobs: typeof readJobRows;
  scheduleAt: typeof junkwareScheduleUpdatedAt;
  corrected: typeof applyPayrollCorrectionsToCrewMetrics;
  callin: typeof readSavedCallInDecisions;
  now: () => number;
};
const defaults: LocalLookupReaders = {
  metrics: readMetrics, jobs: readJobRows, scheduleAt: junkwareScheduleUpdatedAt,
  corrected: applyPayrollCorrectionsToCrewMetrics, callin: readSavedCallInDecisions, now: Date.now,
};
export function validLookupDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T12:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}
const money = (value: unknown) => Number.isFinite(Number(value)) && value != null
  ? new Intl.NumberFormat('en-US', {style:'currency',currency:'USD'}).format(Number(value)) : 'unavailable';
const normalize = (value: string) => value.toLowerCase().replace(/[’']s\b/g,'').replace(/[^a-z0-9]+/g,' ').trim();

/** Bounded saved-source answers only. Maps live for this invocation, never across users/requests. */
export function buildLocalOperationsAnswer(
  question: string, selectedDate: string, role: InteractiveOpsRole,
  readers: LocalLookupReaders = defaults,
): LocalCrewRevenueAnswer | null {
  if (!opsRoleCan(role,'sensitive.write') || !validLookupDate(selectedDate)) return null;
  const q = normalize(question);
  const savedCallin = /^(who|what|which|show)\b/.test(q) && /\b(call in|callin|staffing plan)\b/.test(q);
  // Complex analysis, mutations, and unsupported historical windows remain unmatched.
  if (/\b(why|compare|recommend|save|change|dispatch|send|forecast|monthly|month|year|last|previous|next)\b/.test(q)
    || (!savedCallin && /\b(should|call)\b/.test(q))) return null;
  const explicitDates = question.match(/\b\d{4}-\d{2}-\d{2}\b/g) || [];
  if (new Set(explicitDates).size > 1 || explicitDates.some(date=>!validLookupDate(date))) return null;
  const relative = ['today','tomorrow','yesterday'].filter(word=>new RegExp(`\\b${word}\\b`).test(q));
  if (relative.length > 1 || (explicitDates.length && relative.length)) return null;
  const date = explicitDates[0] || addDays(selectedDate, q.includes('tomorrow') ? 1 : q.includes('yesterday') ? -1 : 0);
  const pay = /\b(pay|paid|paycheck|earn|earned|earnings|gross|make|made|making)\b/.test(q);
  const crew = !savedCallin && /\b(who|crew|krewe)\b/.test(q) && /\b(on|worked|working|clocked|clock|in)\b/.test(q);
  const jobs = /\b(jobs|appointments|schedule|bookings|booked)\b/.test(q);
  const finance = /\b(revenue|sales|profit|expenses)\b/.test(q) && !/\b(employee|credited|attributed|reconcile|payments|merchant|qbo)\b/.test(q);
  // Do not mistake named employee attribution or an unknown qualifier for a
  // company-wide total. The existing monthly attribution path remains intact.
  if (finance && normalize(question.replace(/\b\d{4}-\d{2}-\d{2}\b/g,''))
    .split(' ').some(word=>!['what','is','was','are','were','the','our','company','total','daily','saved','recorded','net','revenue','sales','profit','expenses','how','much','show','me','today','tomorrow','yesterday','on','for'].includes(word))) return null;
  const fleet = /\b(truck|trucks|fleet)\b/.test(q) && /\b(performance|miles|jobs|crew)\b/.test(q);
  const intents = [pay,crew,jobs && !fleet,finance,fleet,savedCallin].filter(Boolean).length;
  if (intents !== 1) return null;
  if (/\b(week|period|overtime)\b/.test(q) && !pay) return null;
  const metrics = new Map<string,AnyRecord|null>();
  const read = (day: string) => {
    if (!metrics.has(day)) {
      const source = readers.metrics(day);
      metrics.set(day, source ? readers.corrected(source,day) : null);
    }
    return metrics.get(day)!;
  };
  const now = readers.now(), today = chicagoDateKey(new Date(now));
  const answer = (text: string, label: string, observed: unknown, workspace: string) => {
    const stamp = typeof observed === 'string' && Number.isFinite(Date.parse(observed)) ? observed : null;
    const stale = date >= today && stamp && now-Date.parse(stamp)>15*60_000;
    const freshness = stamp ? `Source observed ${stamp}${stale ? ' · stale for live use (over 15 minutes old)' : ''}` : 'Source timestamp unavailable';
    return {matched:true as const,model:'OpsCenter sources' as const,
      answer:`${text}\n\n${date} · ${date < today ? 'Historical saved evidence' : date === today ? 'Partial operating day; saved evidence' : 'Future schedule; saved evidence'}. ${freshness}.`,
      sources:[{label,detail:freshness,href:`/desktop?data=live&workspace=${workspace}&date=${date}`}]};
  };
  if (savedCallin) {
    const rows = readers.callin(date);
    const observed = rows.map(row=>row.updatedAt).sort().at(-1);
    return answer(rows.length
      ? `**Saved call-in decisions**\n\n${rows.slice(0,30).map(row=>`- ${row.name} · ${row.status}${row.note?` · ${row.note.slice(0,300)}`:''} · saved ${row.updatedAt}`).join('\n')}${rows.length>30?'\nOnly the first 30 are shown.':''}\n\nRecommended or Called is not confirmed availability. Unavailable entries are not call-in recommendations. This reports saved intent; it does not generate a new staffing recommendation or establish worked/clocked crew.`
      : 'No saved call-in decisions for this target date; availability and staffing cannot be verified.', 'OpsCenter saved call-in plan',observed,'Krewe');
  }
  if (jobs && !fleet) {
    const rows = readers.jobs(date), observed = readers.scheduleAt(date);
    if (!rows.length && !observed) return answer('Schedule source is missing; zero bookings cannot be established.','JunkWare saved schedule',observed,'Schedule');
    const lines = rows.slice(0,30).map(row=>`- ${row.jkNumber || row.appointmentId} · ${row.appointmentTime || 'time missing'} · ${row.territory || 'territory missing'} · ${row.appointmentType} · ${row.status} · ${row.truck || 'truck unassigned'}`);
    return answer(`**${rows.length} saved appointments**\n\n${lines.join('\n')}${rows.length>30 ? '\nOnly the first 30 are shown.' : ''}\n\nScheduled assignments do not establish clock-ins.`, 'JunkWare saved schedule',observed,'Schedule');
  }
  const day = read(date);
  if (!day) return answer('Daily source is missing; values cannot be established.','OpsCenter daily metrics',null,pay||crew?'Krewe':fleet?'Fleet':'Capital');
  const observed = day.payroll_as_of || day.generated_at;
  if (crew) {
    const rows = (day.payroll_records || []).filter((row:AnyRecord)=>/^\d{1,2}:\d{2}(?:\s*[AP]M)?$/i.test(String(row.clock_in||'').trim()) || Number(row.hours_worked)>0);
    const lines = rows.slice(0,100).map((row:AnyRecord)=>`- ${row.name} · ${row.truck || 'truck missing'} · ${row.clock_in || 'clock-in missing'}–${row.clock_out || 'clock-out missing/open'} · ${row.hours_worked ?? 'unknown'} saved hours`);
    return answer(`**${rows.length} people with clock/work evidence**\n\n${lines.join('\n') || 'No clock/work evidence recorded.'}${rows.length>100?'\nOnly the first 100 are shown.':''}\n\nAssignment or revenue credit alone is not a clock-in.`, 'JunkWare saved payroll',observed,'Krewe');
  }
  if (pay) {
    if (!opsRoleCan(role,'finance.read')) return null;
    const period = payPeriodForDate(date), periodRequested = /\b(period|paycheck|overtime)\b/.test(q);
    const weekRequested = /\bweek\b/.test(q);
    const loaded = new Map<string,AnyRecord>(), missing: string[] = [];
    for (let cursor=periodRequested||weekRequested?period.start:date;cursor<=date;cursor=addDays(cursor,1)) {
      const source = read(cursor); if (source) loaded.set(cursor,source); else missing.push(cursor);
    }
    const names = [...new Set([...loaded.values()].flatMap(source=>(source.payroll_records||[]).map((row:AnyRecord)=>String(row.name))))];
    const exact = names.filter(name=>q.includes(normalize(name)));
    const matches = exact.length ? exact : names.filter(name=>normalize(name).split(' ').some(token=>token.length>=3&&q.split(' ').includes(token)));
    if (matches.length!==1) return answer('Name a single employee unambiguously to read individual pay.','JunkWare saved payroll',observed,'Krewe');
    const name = matches[0];
    if (periodRequested||weekRequested) {
      // Freeze at collected hours. Open shifts remain provisional; never extrapolate to wall time.
      const periodData = periodFromMetrics(name,period.start,loaded,addDays(date,1));
      const total = weekRequested&&!periodRequested ? periodData.weeks.find(week=>week.start<=date&&week.end>=date)?.totals : periodData.totals;
      if (!total) return answer('Selected payroll week is missing.','JunkWare saved payroll',observed,'Krewe');
      return answer(`**${name}: ${money(total.totalPay)} observed gross**\n\n${total.hours} hours · ${total.regularHours} regular / ${total.overtimeHours} overtime · ${money(total.regularPay)} regular wages + ${money(total.overtimePay)} overtime wages + ${money(total.tips)} tips + ${money(total.bonuses)} bonuses. ${total.needsReview?'Needs review / provisional.':'Final recorded shifts.'}${missing.length?` Missing dates: ${missing.join(', ')}.`:''}`, 'OpsCenter weekly payroll calculation',observed,'Krewe');
    }
    const row = (day.payroll_records||[]).find((row:AnyRecord)=>row.name===name);
    return answer(`**${name}: ${money(row.total_pay)} recorded daily gross**\n\n${row.hours_worked ?? 'unknown'} hours · ${money(row.hourly_pay)} daily wages + ${money(row.tip)} tips + ${money(row.total_bonus)} bonuses. ${row.pay_is_final?'Final recorded shift.':'Needs review / provisional.'} Weekly overtime is calculated in the pay-period view.`, 'JunkWare saved payroll',observed,'Krewe');
  }
  if (fleet) {
    const requestedTruck = question.match(/\btruck\s*#?\s*(\d+)\b/i)?.[1];
    const keys = [...new Set([...Object.keys(day.jobs_by_truck||{}),...Object.keys(day.miles_by_truck||{}),...Object.keys(day.employees_by_truck||{})])].filter(truck=>!requestedTruck||truck.match(/\d+/)?.[0]===requestedTruck);
    return answer(keys.length ? keys.slice(0,30).map(truck=>`- ${truck} · ${day.jobs_by_truck?.[truck]??'unknown'} jobs · ${day.miles_by_truck?.[truck]??'unknown'} miles · recorded crew: ${(day.employees_by_truck?.[truck]||[]).join(', ')||'missing'}`).join('\n')+'\n\nDaily performance does not establish current location, readiness or availability.' : 'Truck daily performance source is missing.', 'OpsCenter saved truck metrics',day.generated_at,'Fleet');
  }
  const key = /\bprofit\b/.test(q)?'net_profit':/\bexpenses\b/.test(q)?'total_expenses':/\bsales\b/.test(q)?'sales':'total_revenue';
  return answer(`**Saved ${key.replaceAll('_',' ')}: ${money(day[key])}**\n\nThis is the recorded daily metric, not a reconciled payment or accounting total. Missing values remain unavailable.`, 'OpsCenter saved daily finance',day.generated_at,'Capital');
}
