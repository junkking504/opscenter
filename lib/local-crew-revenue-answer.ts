import { readDesktopKrewe } from './desktop-krewe';
import type { InteractiveOpsRole } from './ops-roles';

export type LocalCrewRevenueAnswer = {
  matched: true;
  answer: string;
  model: 'OpsCenter sources';
  sources: Array<{ label: string; detail: string; href: string }>;
};

const MONTHS = [
  'january', 'february', 'march', 'april', 'may', 'june',
  'july', 'august', 'september', 'october', 'november', 'december',
] as const;

function normalize(value: string): string {
  return value.toLocaleLowerCase().replace(/([a-z])[’']s\b/g, '$1').replace(/[’']/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
}

function validDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value)
    && new Date(`${value}T12:00:00Z`).toISOString().slice(0, 10) === value;
}

function requestedThroughDate(question: string, selectedDate: string): string | null {
  if (!validDate(selectedDate)) return null;
  const text = normalize(question);
  if (!/\b(revenue|attributed|credited)\b/.test(text)) return null;
  const namedMonth = MONTHS.findIndex(month => new RegExp(`\\b${month}\\b`).test(text));
  const monthContext = namedMonth >= 0 || /\b(month|monthly|mtd|month to date)\b/.test(text);
  if (!monthContext) return null;

  const selectedYear = Number(selectedDate.slice(0, 4));
  const selectedMonth = Number(selectedDate.slice(5, 7));
  const explicitYear = Number(text.match(/\b(20\d{2})\b/)?.[1] || selectedYear);
  const month = namedMonth >= 0 ? namedMonth + 1 : selectedMonth;
  const year = namedMonth >= 0 && !/\b20\d{2}\b/.test(text) && month > selectedMonth ? selectedYear - 1 : explicitYear;
  const monthKey = `${year}-${String(month).padStart(2, '0')}`;
  const selectedMonthKey = selectedDate.slice(0, 7);
  if (monthKey > selectedMonthKey) return null;
  if (monthKey === selectedMonthKey) return selectedDate;
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return `${monthKey}-${String(lastDay).padStart(2, '0')}`;
}

function uniqueNamedMember<T extends { name: string }>(members: T[], question: string): T | null {
  const text = normalize(question);
  const tokens = new Set(text.split(' ').filter(token => token.length >= 3));
  const fullMatches = members.filter(member => text.includes(normalize(member.name)));
  if (fullMatches.length === 1) return fullMatches[0];
  if (fullMatches.length > 1) return null;
  const tokenMatches = members.filter(member => normalize(member.name).split(' ').some(token => token.length >= 3 && tokens.has(token)));
  return tokenMatches.length === 1 ? tokenMatches[0] : null;
}

function money(value: number): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(value);
}

function periodLabel(start: string, end: string): string {
  const format = (value: string, includeYear: boolean) => new Intl.DateTimeFormat('en-US', {
    month: 'short', day: 'numeric', ...(includeYear ? { year: 'numeric' } : {}), timeZone: 'UTC',
  }).format(new Date(`${value}T12:00:00Z`));
  return `${format(start, false)}–${format(end, true)}`;
}

function dateLabel(value: string): string {
  return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' })
    .format(new Date(`${value}T12:00:00Z`));
}

function sourceTime(value: string | null): string {
  if (!value || !Number.isFinite(Date.parse(value))) return 'source timestamp unavailable';
  return new Intl.DateTimeFormat('en-US', {
    month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: 'America/Chicago',
  }).format(new Date(value));
}

export function buildLocalCrewRevenueAnswer(
  question: string,
  selectedDate: string,
  role: InteractiveOpsRole,
): LocalCrewRevenueAnswer | null {
  const throughDate = requestedThroughDate(question, selectedDate);
  if (!throughDate) return null;
  const snapshot = readDesktopKrewe(throughDate, 'monthly', role);
  const member = uniqueNamedMember(snapshot.members, question);
  if (!member || member.revenue == null) return null;

  const creditedRevenue = Math.round(member.revenue * 100) / 100;
  const jobs = member.jobs == null ? 'Job-credit count unavailable.' : `${member.jobs} employee job credits.`;
  const missing = snapshot.missingDates;
  const coverage = missing.length
    ? ` Coverage note: ${missing.map(dateLabel).join(', ')} ${missing.length === 1 ? 'is' : 'are'} missing from collected daily metrics, so this is observed credited revenue—not a verified complete-period total.`
    : ' Daily source coverage is complete for this period.';
  return {
    matched: true,
    answer: `**${member.name} attributed revenue: ${money(creditedRevenue)}**\n\n${periodLabel(snapshot.start, snapshot.end)} · ${jobs}${coverage}`,
    model: 'OpsCenter sources',
    sources: [{
      label: 'OpsCenter Krewe monthly attribution',
      detail: `${member.name} · ${periodLabel(snapshot.start, snapshot.end)} · observed ${sourceTime(snapshot.sourceUpdatedAt)}`,
      href: `/desktop?data=live&workspace=Krewe&kreweView=monthly&date=${throughDate}`,
    }],
  };
}
