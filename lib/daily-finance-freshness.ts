import { chicagoDateKey } from './chicago-date';
import { money } from './money';

export type FinanceEvidence = { status: 'current' | 'stale' | 'missing'; asOf: string | null; reason?: string };
export type FinanceField = 'revenue' | 'labor' | 'dumps' | 'fuel' | 'totalCosts' | 'net';
type FinanceAmounts = Record<FinanceField, number | null> & { wexIncludedSeparately: boolean };
type WexEvidence = { coverageThrough: string | null; sourceFileModifiedAt: string | null; importedAt: string | null };
const record = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
export type DailyFinanceEvidence = Record<FinanceField, FinanceEvidence>;
export const DAILY_FINANCE_MAX_AGE_MS = 10 * 60_000;
const missing = (): FinanceEvidence => ({ status: 'missing', asOf: null });
const validTime = (value: unknown): value is string => typeof value === 'string' && Number.isFinite(Date.parse(value));

export function combineFinanceEvidence(...inputs: FinanceEvidence[]): FinanceEvidence {
  const unavailable = inputs.find(input => input.status === 'missing' || !validTime(input.asOf));
  const stale = inputs.find(input => input.status === 'stale');
  return { status: unavailable ? 'missing' : stale ? 'stale' : 'current',
    asOf: inputs.every(input => validTime(input.asOf)) ? inputs.map(input => input.asOf!).sort((a, b) => Date.parse(a) - Date.parse(b))[0] : null,
    reason: unavailable?.reason || stale?.reason };
}

/** Publication time never overrides a supplied source contract. Legacy snapshots
 * use their publication time only until source-specific evidence is available. */
export function dailyFinanceEvidence(metrics: Record<string, unknown> | null, summary: FinanceAmounts, date: string, wex?: WexEvidence): DailyFinanceEvidence {
  const contract = metrics?.source_freshness;
  const legacy = metrics?.generated_at || metrics?.updated_at;
  const read = (group: 'metrics' | 'sources', name: string): FinanceEvidence => {
    if (contract == null) return validTime(legacy) ? { status: 'current', asOf: legacy } : missing();
    const schema = record(contract);
    const entry = schema.version === 1 ? record(record(schema[group])[name]) : {};
    if (!entry || !['current', 'stale', 'missing'].includes(String(entry.status))) return missing();
    return { status: entry.status as FinanceEvidence['status'], asOf: validTime(entry.as_of) ? entry.as_of : null, reason: typeof entry.reason === 'string' ? entry.reason : undefined };
  };
  const known = (value: number | null, evidence: FinanceEvidence) => value == null ? { ...evidence, status: 'missing' as const } : evidence;
  const revenue = known(summary.revenue, read('metrics', 'revenue'));
  const labor = known(summary.labor, read('metrics', 'payroll'));
  const dumps = known(summary.dumps, read('sources', 'junkware_truck_records'));
  const fuel = summary.wexIncludedSeparately
    ? { status: wex?.coverageThrough && wex.coverageThrough >= date ? 'current' as const : 'missing' as const,
        asOf: wex?.sourceFileModifiedAt || wex?.importedAt || null, reason: 'Posted WEX coverage' }
    : known(summary.fuel, read('sources', 'junkware_truck_records'));
  const totalCosts = combineFinanceEvidence(read('metrics', 'costs'), revenue, labor, dumps, fuel);
  return { revenue, labor, dumps, fuel, totalCosts, net: combineFinanceEvidence(read('metrics', 'net'), revenue, totalCosts) };
}

export function financeReading(recorded: number | null, evidence: FinanceEvidence | undefined, date: string, now = Date.now()) {
  const source = evidence || missing();
  const stamp = validTime(source.asOf) ? Date.parse(source.asOf) : NaN;
  const age = now - stamp;
  const selectedDay = /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : chicagoDateKey(new Date(now));
  const historical = selectedDay < chicagoDateKey(new Date(now));
  // An earlier-day snapshot cannot establish the selected day's revenue, even
  // immediately after midnight. Future timestamps do not establish freshness.
  const wrongDay = Number.isFinite(stamp) && chicagoDateKey(new Date(stamp)) < selectedDay;
  const state = recorded == null || source.status === 'missing' || !Number.isFinite(stamp) || age < -60_000 ? 'missing'
    : source.status === 'stale' || wrongDay || (!historical && age > DAILY_FINANCE_MAX_AGE_MS) ? 'stale' : 'current';
  const minutes = Math.max(0, Math.floor(age / 60_000));
  const ageLabel = minutes < 60 ? `${minutes}m old` : `${Math.floor(minutes / 60)}h ${minutes % 60}m old`;
  const time = Number.isFinite(stamp) ? new Date(stamp).toLocaleString('en-US', { timeZone: 'America/Chicago', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : null;
  const sourceLabel = time ? `${historical ? 'Snapshot' : 'Source'} ${time}${historical ? '' : ` · ${ageLabel}`}` : 'Source time unavailable';
  const last = recorded == null ? '' : ` · Last recorded ${money(recorded)}`;
  return { value: state === 'current' ? recorded : null, state,
    detail: state === 'current' ? sourceLabel : `${state === 'stale' ? 'Stale source' : 'Input unavailable'}${last} · ${sourceLabel}` };
}

export function presentDailyFinance(summary: FinanceAmounts, evidence: DailyFinanceEvidence | undefined, date: string, now = Date.now()) {
  return Object.fromEntries((['revenue', 'labor', 'dumps', 'fuel', 'totalCosts', 'net'] as const)
    .map(field => [field, financeReading(summary[field], evidence?.[field], date, now)])) as Record<FinanceField, ReturnType<typeof financeReading>>;
}

export type FinanceKpiEvidence = { date: string; recorded: number | null; evidence: FinanceEvidence; currentDetail: string; ratioEvidence?: FinanceEvidence };
/** Re-age a retained Command snapshot even when its next network read fails. */
export function ageFinanceKpi<T extends { value: string; detail: string; secondaryValue?: string; progress: number; tone: string; financeEvidence?: FinanceKpiEvidence }>(kpi: T, now = Date.now()): T {
  if (!kpi.financeEvidence) return kpi;
  const { recorded, evidence, date, currentDetail } = kpi.financeEvidence;
  const reading = financeReading(recorded, evidence, date, now);
  const ratioUnavailable = kpi.financeEvidence.ratioEvidence && financeReading(1, kpi.financeEvidence.ratioEvidence, date, now).state !== 'current';
  return reading.state === 'current' ? { ...kpi, ...(ratioUnavailable ? { secondaryValue: undefined, progress: 0, tone: 'warning' } : {}), detail: `${ratioUnavailable ? 'Recorded payroll · revenue ratio unavailable' : currentDetail} · ${reading.detail}` }
    : { ...kpi, value: '—', secondaryValue: undefined, detail: reading.detail, progress: 0, tone: 'warning' };
}
