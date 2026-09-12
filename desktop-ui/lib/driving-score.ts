export type DrivingScore = {
  date: string; truck: string; drivers: string[]; score: number | null;
  display: string; status: string; source: string; warning: string;
  attribution: 'confirmed' | 'review' | 'truck';
  miles: number | null; driveMinutes: number | null; idleMinutes: number | null;
  safetyScore: number | null; idleScore: number | null; afterHoursPenalty: number | null;
  events: Array<{ label: string; count: number | null; deduction: number | null }>;
};
export function drivingSummary(rows: DrivingScore[]) {
  const days = new Map<string, DrivingScore[]>();
  for (const row of rows) days.set(row.date, [...(days.get(row.date) || []), row]);
  const confirmedDays = [...days.values()].filter(day => day.length && day.every(row => row.attribution === 'confirmed' && row.score !== null));
  return {scoredDays: confirmedDays.length, belowDays: confirmedDays.filter(day => day.some(row => row.score! < 60)).length,
    reviewDays: [...days.values()].filter(day => day.some(row => row.attribution !== 'confirmed')).length};
}
