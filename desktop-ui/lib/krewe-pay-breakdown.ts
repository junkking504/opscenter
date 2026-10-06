import { sumObserved, type CrewAmounts, type DesktopCrewMember } from './people-fleet-contract';

export type PayBreakdown = Pick<CrewAmounts, 'labor' | 'tips' | 'bonuses' | 'supplemental' | 'totalPay'>;
export function payForDays(days: DesktopCrewMember['days'], start: string, end: string): PayBreakdown {
  const selected = days.filter(day => day.date >= start && day.date <= end);
  return {
    labor: sumObserved(selected.map(day => day.labor)),
    tips: sumObserved(selected.map(day => day.tips)),
    bonuses: sumObserved(selected.map(day => day.bonuses)),
    supplemental: sumObserved(selected.map(day => day.supplemental)),
    totalPay: sumObserved(selected.map(day => day.totalPay)),
  };
}
export function payBreakdownDifference(pay: PayBreakdown): number | null {
  const parts = sumObserved([pay.labor, pay.tips, pay.bonuses, pay.supplemental]);
  return parts === null || pay.totalPay === null ? null : Math.round((pay.totalPay - parts) * 100) / 100;
}

/** Employee-attributed revenue, separate from earnings and full job value. */
export function creditedRevenueForDays(days: DesktopCrewMember['days'], start: string, end: string): number | null {
  return sumObserved(days.filter(day => day.date >= start && day.date <= end).map(day => day.revenue ?? null));
}
