import { availableDates, readMetrics, type AnyRecord } from './opsData';
import { sourceTerritoryCode, serviceTerritoryLabels } from './service-territory';
import { addDays, chicagoDateKey } from './chicago-date';

const weekdays = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const months = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
const normalized = (question: string) => question.toLowerCase().replace(/[’']/g, '').replace(/[^a-z0-9]+/g, ' ');
type Row = { date: string; metrics: AnyRecord };
type Metric = 'jobs' | 'revenue';
type Intent = { metric: Metric; operation: 'average' | 'total' | 'weekday'; territories: string[] };

export function territoryReportingIntent(question: string): Intent | null {
  const text = normalized(question);
  const territories = Object.values(serviceTerritoryLabels).filter(name => name !== 'Unclassified' && text.includes(name.toLowerCase()));
  if (!territories.length && !/\b(territory|territories|market|markets)\b/.test(text)) return null;
  if (/\b(compare|comparison|growth|change|profit|margin|forecast|predict|booked|scheduled)\b/.test(text)) return null;
  const metric = /\b(revenue|sales)\b/.test(text) ? 'revenue' : 'jobs';
  const weekday = /\b(busiest|busy|most jobs|highest volume|highest revenue|best weekday)\b/.test(text) && /\b(weekday|week|day)\b/.test(text);
  if (weekday) return { metric, operation: 'weekday', territories };
  if (metric === 'jobs' && !/\b(jobs|job)\b/.test(text)) return null;
  if (/\b(average|avg|mean)\b/.test(text) && /\b(day|daily)\b/.test(text)) return { metric, operation: 'average', territories };
  if (/\b(total|totals|how many|how much|revenue|sales)\b/.test(text) && !/\b(average|avg|mean)\b/.test(text)) return { metric, operation: 'total', territories };
  return null;
}

export function territoryAverageQuestion(question: string): boolean {
  return territoryReportingIntent(question)?.operation === 'average';
}
export function territoryDemandQuestion(question: string): boolean {
  return territoryReportingIntent(question) !== null;
}

function validDate(value: string): boolean {
  const date = new Date(`${value}T12:00:00Z`);
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}
const monthEnd = (year: number, month: number) => new Date(Date.UTC(year, month, 0, 12)).toISOString().slice(0, 10);

export function territoryReportingPeriod(question: string, selectedDate: string, today = chicagoDateKey()) {
  if (!validDate(selectedDate) || !validDate(today)) return null;
  const anchor = selectedDate < today ? selectedDate : today;
  const lastComplete = addDays(anchor, -1);
  const text = normalized(question);
  let start: string, end = lastComplete;
  const explicit = [...question.matchAll(/\b\d{4}-\d{2}-\d{2}\b/g)].map(match => match[0]);
  const rolling = text.match(/\b(?:last|past|previous) (\d+) (days|weeks|months)\b/);
  const named = months.map((month, index) => ({ index, match: new RegExp(`\\b${month}\\b`).test(text) })).filter(row => row.match);
  if (explicit.length) {
    if (explicit.length !== 2 || !explicit.every(validDate)) return null;
    [start, end] = explicit;
  } else if (rolling) {
    const amount = Number(rolling[1]);
    if (amount < 1 || amount > 1095) return null;
    if (rolling[2] === 'months') {
      const date = new Date(`${anchor}T12:00:00Z`);
      const target = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() - amount, 1, 12));
      const day = Math.min(date.getUTCDate(), Number(monthEnd(target.getUTCFullYear(), target.getUTCMonth() + 1).slice(8)));
      target.setUTCDate(day); start = target.toISOString().slice(0, 10);
    } else start = addDays(end, 1 - amount * (rolling[2] === 'weeks' ? 7 : 1));
  } else if (named.length) {
    if (named.length !== 1) return null;
    const month = named[0].index + 1;
    const year = Number(text.match(/\b20\d{2}\b/)?.[0] || (Number(anchor.slice(0, 4)) - (month > Number(anchor.slice(5, 7)) ? 1 : 0)));
    start = `${year}-${String(month).padStart(2, '0')}-01`; end = monthEnd(year, month);
  } else if (/\b(last|previous) month\b/.test(text)) {
    end = addDays(`${anchor.slice(0, 7)}-01`, -1); start = `${end.slice(0, 7)}-01`;
  } else if (/\b(this month|month to date|mtd)\b/.test(text)) {
    start = `${anchor.slice(0, 7)}-01`;
  } else if (/\b(last|past|previous) year\b/.test(text)) {
    start = addDays(end, -364);
  } else if (/\b(this year|year to date|ytd)\b/.test(text)) {
    start = `${anchor.slice(0, 4)}-01-01`;
  } else if (/\b20\d{2}\b/.test(text)) {
    const year = text.match(/\b20\d{2}\b/)![0]; start = `${year}-01-01`; end = `${year}-12-31`;
  } else {
    // Never silently discard an unrecognized date qualifier.
    if (/\b(today|yesterday|tomorrow|month|year|week|quarter|since|between|from|through|until|days)\b/.test(text) && !/\b(day of the week|weekday)\b/.test(text)) return null;
    start = addDays(end, -364);
  }
  if (end > lastComplete) end = lastComplete;
  const days = Math.round((Date.parse(`${end}T12:00:00Z`) - Date.parse(`${start}T12:00:00Z`)) / 86400000) + 1;
  return days > 0 && days <= 1095 ? { start, end, days } : null;
}

function dailyTerritoryValues(metrics: AnyRecord, metric: Metric): Map<string, number> {
  const daily = new Map<string, number>();
  if (metrics.provisional !== false) return daily;
  for (const [rawTerritory, count] of Object.entries(metrics[metric === 'jobs' ? 'jobs_by_market' : 'revenue_by_market'] || {})) {
    if (typeof count !== 'number' || !Number.isFinite(count) || count < 0 || (metric === 'jobs' && !Number.isInteger(count))) continue;
    const territory = serviceTerritoryLabels[sourceTerritoryCode(rawTerritory)];
    daily.set(territory, (daily.get(territory) || 0) + count);
  }
  return daily;
}

export function territoryDailyAverages(rows: Row[], metric: Metric = 'jobs') {
  const groups = new Map<string, { jobs: number; recordedDays: number; operatingDays: number }>();
  for (const { metrics } of rows) {
    for (const [territory, count] of dailyTerritoryValues(metrics, metric)) {
      const group = groups.get(territory) || { jobs: 0, recordedDays: 0, operatingDays: 0 };
      group.jobs += count; group.recordedDays++; if (count > 0) group.operatingDays++;
      groups.set(territory, group);
    }
  }
  return [...groups].sort(([a], [b]) => a.localeCompare(b)).map(([territory, group]) => ({
    territory, ...group, calendarAverage: group.jobs / group.recordedDays,
    operatingAverage: group.operatingDays ? group.jobs / group.operatingDays : null,
  }));
}

export function territoryWeekdaySummary(rows: Row[], metric: Metric = 'jobs') {
  const groups = new Map<string, Array<{ total: number; samples: number }>>();
  for (const { date, metrics } of rows) {
    const day = new Date(`${date}T12:00:00Z`).getUTCDay();
    if (!Number.isFinite(day)) continue;
    for (const [territory, count] of dailyTerritoryValues(metrics, metric)) {
      if (metric === 'jobs' && count === 0) continue;
      if (!groups.has(territory)) groups.set(territory, weekdays.map(() => ({ total: 0, samples: 0 })));
      const group = groups.get(territory)![day]; group.total += count; group.samples++;
    }
  }
  return [...groups].sort(([a], [b]) => a.localeCompare(b)).map(([territory, days]) => {
    const eligible = days.map((row, day) => ({ ...row, day, average: row.total / row.samples })).filter(row => row.samples >= 3);
    const best = Math.max(...eligible.map(row => row.average));
    return { territory, winners: eligible.filter(row => Math.abs(row.average - best) < 1e-9), coveredWeekdays: eligible.length };
  });
}

export function buildLocalTerritoryDemandAnswer(question: string, selectedDate: string) {
  const intent = territoryReportingIntent(question);
  if (!intent) return null;
  const period = territoryReportingPeriod(question, selectedDate);
  if (!period) return { matched: true, model: 'OpsCenter sources', answer: 'Please specify a reporting period: last 365 days, last month, September 2026, or two YYYY-MM-DD dates. Historical reporting uses completed days and supports at most 1,095 days.', sources: [] };
  const { start, end, days } = period;
  const rows = availableDates().filter(date => date >= start && date <= end).flatMap(date => {
    const metrics = readMetrics(date); return metrics ? [{ date, metrics }] : [];
  });
  const include = (territory: string) => !intent.territories.length || intent.territories.includes(territory);
  const format = (value: number) => intent.metric === 'revenue' ? new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(value) : value.toLocaleString('en-US', { maximumFractionDigits: 2, minimumFractionDigits: 2 });
  const unit = intent.metric === 'revenue' ? 'revenue' : 'jobs';
  let lines: string[];
  let basis: string;
  if (intent.operation === 'weekday') {
    lines = territoryWeekdaySummary(rows, intent.metric).filter(row => include(row.territory)).map(row => row.winners.length
      ? `- **${row.territory}: ${row.winners.map(winner => weekdays[winner.day]).join(' / ')}** — ${format(row.winners[0].average)} ${unit} per ${intent.metric === 'jobs' ? 'operating' : 'recorded'} day (${row.winners.map(winner => `${winner.samples} ${weekdays[winner.day]} observations`).join('; ')}).${row.coveredWeekdays < 7 ? ' Some weekdays have fewer than 3 observations.' : ''}`
      : `- **${row.territory}: insufficient history** — no weekday has 3 observations.`);
    basis = `Ranked by weekday average; at least 3 observations per weekday. ${intent.metric === 'jobs' ? 'Zero-job territory days are excluded.' : 'Explicit zero-revenue days are included.'}`;
  } else {
    lines = territoryDailyAverages(rows, intent.metric).filter(row => include(row.territory)).map(row => {
      const headline = intent.operation === 'average' ? `${format(row.calendarAverage)} ${unit} per recorded day` : `${format(row.jobs)} ${unit} recorded`;
      return `- **${row.territory}: ${headline}** — ${format(row.jobs)} ${unit} ÷ ${row.recordedDays} recorded days. ${intent.metric === 'jobs' && row.operatingAverage != null ? `${format(row.operatingAverage)} per operating day (${row.operatingDays} positive-job days). ` : ''}${days - row.recordedDays} calendar dates lack usable ${unit} metrics for this territory.`;
    });
    basis = 'Recorded-day averages include explicit zeros. Missing dates and absent territory counts are excluded, never treated as zero. Where coverage is incomplete, these are observed totals/averages, not verified complete-period figures.';
  }
  const usable = rows.filter(row => dailyTerritoryValues(row.metrics, intent.metric).size > 0);
  const sourceTime = usable.map(row => String(row.metrics.generated_at || row.metrics.updated_at || '')).filter(Boolean).sort().at(-1);
  const title = intent.operation === 'weekday' ? 'Busiest weekday by territory' : intent.operation === 'average' ? `Average ${unit} per day by territory` : `Total ${unit} by territory`;
  return {
    matched: true, model: 'OpsCenter sources',
    answer: `**${title}**\n\n${start}–${end} · ${days} completed calendar days. Territory means the published JunkWare market, separate from address-based dispatch areas.\n\n${lines.length ? lines.join('\n') : 'Territory history is unavailable for this period.'}\n\n${basis} ${usable.length}/${days} calendar dates have non-provisional ${unit} metrics for at least one territory. Current, future and provisional days are excluded.`,
    sources: [{ label: 'Published daily territory metrics', detail: `${intent.metric === 'jobs' ? 'jobs_by_market' : 'revenue_by_market'} · ${start}–${end} · latest source update ${sourceTime || 'unavailable'}`, href: `/desktop?data=live&workspace=Finance&financeView=trends&date=${selectedDate}` }],
  };
}
