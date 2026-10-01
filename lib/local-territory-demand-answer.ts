import { availableDates, readMetrics, type AnyRecord } from './opsData';
import { sourceTerritoryCode, serviceTerritoryLabels } from './service-territory';
import { addDays, chicagoDateKey } from './chicago-date';

const weekdays = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const normalized = (question: string) => question.toLowerCase().replace(/[’']/g, '').replace(/[^a-z0-9]+/g, ' ');

export function territoryDemandQuestion(question: string): boolean {
  const text = normalized(question);
  return /\b(busiest|busy|most jobs|highest volume)\b/.test(text)
    && /\b(weekday|week|day)\b/.test(text) && /\b(territory|territories|market|markets)\b/.test(text);
}

export function territoryWeekdaySummary(rows: Array<{ date: string; metrics: AnyRecord }>) {
  const groups = new Map<string, Array<{ total: number; samples: number }>>();
  for (const { date, metrics } of rows) {
    if (metrics.provisional !== false) continue;
    const day = new Date(`${date}T12:00:00Z`).getUTCDay();
    if (!Number.isFinite(day)) continue;
    const daily = new Map<string, number>();
    for (const [rawTerritory, count] of Object.entries(metrics.jobs_by_market || {})) {
      if (typeof count !== 'number' || !Number.isFinite(count) || count <= 0 || !Number.isInteger(count)) continue;
      const code = sourceTerritoryCode(rawTerritory);
      const territory = serviceTerritoryLabels[code];
      daily.set(territory, (daily.get(territory) || 0) + count);
    }
    for (const [territory, count] of daily) {
      if (!groups.has(territory)) groups.set(territory, weekdays.map(() => ({ total: 0, samples: 0 })));
      const group = groups.get(territory)![day];
      group.total += count; group.samples++;
    }
  }
  return [...groups].sort(([a], [b]) => a.localeCompare(b)).map(([territory, days]) => {
    const eligible = days.map((row, day) => ({ ...row, day, average: row.total / row.samples })).filter(row => row.samples >= 3);
    const best = Math.max(...eligible.map(row => row.average));
    return { territory, winners: eligible.filter(row => Math.abs(row.average - best) < 1e-9), coveredWeekdays: eligible.length };
  });
}

export function buildLocalTerritoryDemandAnswer(question: string, selectedDate: string) {
  if (!territoryDemandQuestion(question)) return null;
  const today = chicagoDateKey();
  const through = addDays(selectedDate < today ? selectedDate : today, -1);
  const text = normalized(question);
  // Explicit periods outside the supported rolling windows need the assistant's clarification.
  const requestedDays = text.match(/\b(?:last|past) (\d+) days\b/);
  if (/\b(month|year|january|february|march|april|may|june|july|august|september|october|november|december)\b/.test(text) || /\b20\d{2}\b/.test(text)) return null;
  const days = requestedDays ? Number(requestedDays[1]) : 365;
  if (!Number.isInteger(days) || days < 7 || days > 365) return null;
  const start = addDays(through, 1 - days);
  const rows = availableDates().filter(date => date >= start && date <= through).flatMap(date => {
    const metrics = readMetrics(date);
    return metrics ? [{ date, metrics }] : [];
  });
  const summary = territoryWeekdaySummary(rows);
  const lines = summary.map(row => row.winners.length
    ? `- **${row.territory}: ${row.winners.map(winner => weekdays[winner.day]).join(' / ')}** — ${row.winners[0].average.toFixed(1)} jobs per operating day (${row.winners.map(winner => `${winner.samples} ${weekdays[winner.day]} observations`).join('; ')}).${row.coveredWeekdays < 7 ? ' Some weekdays have fewer than 3 observations.' : ''}`
    : `- **${row.territory}: insufficient history** — no weekday has 3 operating-day observations.`);
  const usable = rows.filter(row => row.metrics.provisional === false && Object.keys(row.metrics.jobs_by_market || {}).length > 0);
  const sourceTime = usable.map(row => String(row.metrics.generated_at || row.metrics.updated_at || '')).filter(Boolean).sort().at(-1);
  return {
    matched: true,
    model: 'OpsCenter sources',
    answer: `**Busiest weekday by territory**\n\n${start}–${through} · ranked by average published jobs per operating day. Territory means the published JunkWare market; address-based dispatch areas are not reconstructed.\n\n${lines.length ? lines.join('\n') : 'Territory job history is unavailable for this period.'}\n\n${usable.length}/${days} calendar dates have non-provisional territory metrics. Missing records and zero-job territory days are excluded; missing territories are not treated as zero. Rankings require at least 3 observations per weekday. This describes observed history, not booked demand.`,
    sources: [{ label: 'Published daily territory metrics', detail: `jobs_by_market · ${start}–${through} · latest source update ${sourceTime || 'unavailable'}`, href: `/desktop?data=live&workspace=Finance&financeView=trends&date=${selectedDate}` }],
  };
}
