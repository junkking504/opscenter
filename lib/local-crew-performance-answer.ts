import { readDesktopKrewe } from './desktop-krewe';
import { chicagoDateKey } from './report-dates';
import { opsRoleCan, type InteractiveOpsRole } from './ops-roles';
import type { LocalCrewRevenueAnswer } from './local-crew-revenue-answer';

const months = ['january','february','march','april','may','june','july','august','september','october','november','december'];
const money = (value: number) => value.toLocaleString('en-US', { style: 'currency', currency: 'USD' });
const observed = (value: number | null): value is number => value !== null && Number.isFinite(value);
const safeName = (name: string) => name.replace(/[\[\]()*_`<>#|\\\r\n]/g, ' ').trim();

/** Manager-only saved metrics. Nothing in this answer is sent to the provider. */
export function buildLocalCrewPerformanceAnswer(
  question: string, selectedDate: string, role: InteractiveOpsRole,
  read: typeof readDesktopKrewe = readDesktopKrewe,
  today = chicagoDateKey(),
): LocalCrewRevenueAnswer | null {
  if (!opsRoleCan(role, 'sensitive.write')) return null;
  const q = question.toLowerCase().replace(/[-–]/g, ' ').replace(/\s+/g, ' ').trim();
  if (!/\b(employee|employees|crew|krewe|worker|workers|team member)\b/.test(q)
    || !/\b(best|top|highest|leading|leader|leaders|rank|ranking)\b/.test(q)) return null;
  if (/\b(fire|hire|promote|demote|terminate|assign|send|change|delete)\b/.test(q)) return null;
  const answer = (text: string, sources: LocalCrewRevenueAnswer['sources'] = []): LocalCrewRevenueAnswer => ({ matched: true, answer: text, model: 'OpsCenter sources', sources });
  const validDate = (date: string) => /^\d{4}-\d{2}-\d{2}$/.test(date) && Number.isFinite(Date.parse(`${date}T12:00:00Z`)) && new Date(`${date}T12:00:00Z`).toISOString().slice(0,10) === date;
  if (!validDate(selectedDate) || !validDate(today)) return null;
  const anchor = selectedDate < today ? selectedDate : today;
  const named = months.filter(month => new RegExp(`\\b${month}\\b`).test(q));
  const current = /\b(this month|current month|month to date|mtd)\b/.test(q);
  const previous = /\b(last month|previous month)\b/.test(q);
  const years = q.match(/\b20\d{2}\b/g) || [];
  if (named.length > 1 || Number(current) + Number(previous) + Number(named.length > 0) > 1 || years.length > 1
    || /\b(today|yesterday|tomorrow|week|weeks|year|years|ytd|all time|quarter|days|since|between|before|after)\b/.test(q)
    || /\d{4} \d{2} \d{2}/.test(q) || (years.length && !named.length)) {
    return answer('Employee comparisons currently support one calendar month. Ask for September 2026, last month, or this month; I cannot verify the requested period from this comparison.');
  }
  if (/\b(profit|margin|safety|safest|attendance|reviews|rating|ratings|punctuality|reliable|reliability|pay|paid|salary|tips|bonus|bonuses)\b/.test(q)) {
    return answer('I can compare employee credited revenue, job credits, and credited revenue per recorded hour for a calendar month. This comparison does not establish a leader for the metric you requested.');
  }
  let end: string;
  let periodBasis: string;
  if (current) { end = anchor; periodBasis = 'Requested month to date'; }
  else if (named.length) {
    const month = months.indexOf(named[0]) + 1;
    const year = years.length ? Number(years[0]) : Number(anchor.slice(0,4)) - (month > Number(anchor.slice(5,7)) ? 1 : 0);
    const key = `${year}-${String(month).padStart(2,'0')}`;
    if (key > anchor.slice(0,7)) return answer('That month is in the future relative to the selected operating day. No performance ranking is available.');
    end = key === anchor.slice(0,7) ? anchor : new Date(Date.UTC(year,month,0)).toISOString().slice(0,10);
    periodBasis = 'Requested calendar month';
  } else {
    end = new Date(Date.UTC(Number(anchor.slice(0,4)),Number(anchor.slice(5,7))-1,0)).toISOString().slice(0,10);
    periodBasis = previous ? 'Requested previous month' : 'Default: last completed calendar month';
  }
  const snapshot = read(end, 'monthly', role);
  const byHour = /\b(per hour|hourly|efficiency|efficient|productive|productivity)\b/.test(q);
  const byJobs = !byHour && /\b(jobs|job credits)\b/.test(q) && !/\brevenue\b/.test(q);
  const metric = byHour ? 'credited revenue per recorded hour' : byJobs ? 'employee job credits' : 'credited revenue';
  const rows = snapshot.members.map(member => {
    // sumObserved can hide a missing component. Require matched daily coverage for a rate.
    const revenueComplete = member.days.length > 0 && member.days.every(day => observed(day.revenue));
    const hoursComplete = member.days.length > 0 && member.days.every(day => observed(day.hours) && day.hours >= 0 && !(day.revenue !== null && day.revenue > 0 && day.hours === 0));
    const jobsComplete = member.days.length > 0 && member.days.every(day => observed(day.jobs));
    const rate = revenueComplete && hoursComplete && observed(member.revenue) && observed(member.hours) && member.hours > 0 ? member.revenue / member.hours : null;
    const value = byHour ? rate : byJobs ? member.jobs : member.revenue;
    return { member, rate, value: observed(value) ? Math.round(value * 100) / 100 : null, partial: byJobs ? !jobsComplete : !revenueComplete };
  }).filter(row => row.value !== null).sort((a,b) => b.value! - a.value! || a.member.name.localeCompare(b.member.name));
  const sourceAt = snapshot.sourceUpdatedAt && Number.isFinite(Date.parse(snapshot.sourceUpdatedAt)) ? snapshot.sourceUpdatedAt : 'unavailable';
  const sources = [{ label: 'Crew monthly metrics', detail: `${snapshot.start}–${snapshot.end} · period-end source timestamp: ${sourceAt}`, href: `/desktop?data=live&workspace=Krewe&kreweView=monthly&date=${end}` }];
  const period = `${periodBasis}: ${snapshot.start}–${snapshot.end}.`;
  if (!rows.length || rows[0].value! <= 0) return answer(`${period}\n\nNo positive ${metric} comparison can be established from the saved employee metrics. Missing values are unavailable, not zero.`, sources);
  const leaders = rows.filter(row => row.value === rows[0].value);
  const headline = leaders.length === 1 ? `**${safeName(leaders[0].member.name)} leads observed ${metric}.**` : `**Tied leaders in observed ${metric}: ${leaders.map(row => safeName(row.member.name)).join(', ')}.**`;
  const shown = rows.filter((row,index) => index < 3 || row.value === rows[2]?.value);
  const lines = shown.map(({ member, rate, partial }) => `- **${safeName(member.name)}**: ${observed(member.revenue) ? money(member.revenue) : 'unavailable'} credited revenue; ${observed(member.jobs) ? member.jobs : 'unavailable'} employee job credits; ${rate !== null ? `${money(rate)}/recorded hour` : 'revenue/hour unavailable'}${partial ? ' (partial metric coverage)' : ''}.`);
  const otherLeaders: string[] = [];
  if (!byHour && !byJobs && !/\brevenue\b/.test(q)) {
    const jobRows = snapshot.members.filter(member => observed(member.jobs));
    const mostJobs = Math.max(0, ...jobRows.map(member => member.jobs!));
    if (mostJobs > 0) otherLeaders.push(`Job-credit leader(s): ${jobRows.filter(member => member.jobs === mostJobs).map(member => safeName(member.name)).join(', ')} — ${mostJobs} employee job credits.`);
    const rateRows = rows.filter(row => row.rate !== null);
    const highestRate = Math.max(0, ...rateRows.map(row => Math.round(row.rate! * 100) / 100));
    if (highestRate > 0) otherLeaders.push(`Revenue/hour leader(s): ${rateRows.filter(row => Math.round(row.rate! * 100) / 100 === highestRate).map(row => `${safeName(row.member.name)} (${row.member.hours} recorded hours across ${row.member.days.length} employee day records)`).join(', ')} — ${money(highestRate)}/recorded hour. Small samples can distort this rate.`);
  }
  const comparison = otherLeaders.length ? `\n\n${otherLeaders.join('\n\n')}` : '';
  const excluded = snapshot.members.length - rows.length;
  const coverage = snapshot.missingDates.length ? `${snapshot.missingDates.length} missing daily metrics date(s): ${snapshot.missingDates.join(', ')}. Ranking is provisional and may change with missing records.` : 'Daily metrics files are present for the period; employee-level completeness is not independently verified.';
  return answer(`${headline}\n\n${period} Ranked by ${metric}; ${rows.length} employees with observed values${excluded ? `; ${excluded} excluded because that metric is unavailable` : ''}.\n\n${lines.join('\n')}${comparison}\n\n${coverage}\n\nCredited revenue measures attributed production, not profit or an overall employee score. Job credits can be shared across crew members. Assignments and hours affect totals; quality, safety, and attendance are not scored here.`, sources);
}
