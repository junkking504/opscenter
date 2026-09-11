import type { RecyclingRecord } from './commercial-contract';

export function recyclingMonth(records: RecyclingRecord[], month: string) {
  const runs = records.filter(run => run.date.slice(0, 7) === month).sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
  const received = records.filter(run => run.status === 'Paid' && run.paymentDate?.slice(0, 7) === month);
  const sum = (values: Array<number | null>) => values.some(value => value == null) ? null : values.reduce<number>((total, value) => total + Math.round(value! * 100), 0) / 100;
  return {
    runs, received,
    runValue: sum(runs.map(run => run.status === 'Paid' ? run.realizedValue : run.expectedValue)),
    paidValue: sum(runs.filter(run => run.status === 'Paid').map(run => run.realizedValue)),
    receivedValue: sum(received.map(run => run.realizedValue)),
    missingPaymentDates: records.filter(run => run.status === 'Paid' && !run.paymentDate).length,
    days: [...new Set(runs.map(run => run.date))].map(date => {
      const entries = runs.filter(run => run.date === date);
      return { date, entries, value: sum(entries.map(run => run.status === 'Paid' ? run.realizedValue : run.expectedValue)) };
    }),
  };
}

export function adjacentRecyclingMonth(month: string, offset: number) {
  const date = new Date(`${month}-01T12:00:00Z`);
  date.setUTCMonth(date.getUTCMonth() + offset);
  return date.toISOString().slice(0, 7);
}
