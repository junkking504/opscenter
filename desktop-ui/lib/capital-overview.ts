import type { FinanceData } from './commercial-contract';

/** Keep calendar gaps visible rather than silently treating missing months as zero. */
export function capitalRevenueHistory(trends: FinanceData['trends'], date: string) {
  const [year, month] = date.slice(0, 7).split('-').map(Number);
  return Array.from({ length: 6 }, (_, index) => {
    const stamp = new Date(Date.UTC(year, month - 6 + index, 1, 12));
    const key = stamp.toISOString().slice(0, 7);
    const record = trends.find(item => item.monthKey === key);
    const revenue = record && record.revenueCovered !== false && Number.isFinite(record.grossRevenue) ? record.grossRevenue : null;
    return { key, label: stamp.toLocaleDateString('en-US', { month: 'short', timeZone: 'UTC' }), revenue, partial: Boolean(record && !(record.reportingComplete ?? record.complete)) };
  });
}
