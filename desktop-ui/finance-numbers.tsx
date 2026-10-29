import { MetricValue } from './metric-value';
import { commercialDate, commercialMoney, type FinanceData } from './lib/commercial-contract';
import { preferredStatements } from './lib/financial-statements';

/** Keep source periods separate; never substitute a workbook or another month. */
export function FinanceNumbers({ data, date }: { data: FinanceData; date: string }) {
  const records = data.statements?.available ? preferredStatements(data.statements.records.filter(record => record.sourceKind === 'qbo' && record.month === date.slice(0, 7))) : [];
  const through = records[0]?.periodEnd;
  const comparable = records.length > 0 && Boolean(through) && records.every(record => record.periodEnd === through && record.basis === records[0].basis && Number.isFinite(record.totals.income));
  const income = comparable ? records.reduce((total, record) => total + record.totals.income, 0) / 100 : null;
  const amount = (value: number | null | undefined) => <MetricValue value={value != null && Number.isFinite(value) ? commercialMoney(value) : <span className="missing-value">Unavailable</span>} />;
  return <section className="capital-panel finance-numbers" aria-labelledby="finance-numbers-title">
    <header><h3 id="finance-numbers-title">Where Do These Numbers Come From?</h3></header>
    <div className="finance-number-columns">
      <article><h4>Operating Revenue</h4><strong>{amount(data.month.revenue)}</strong><p>JunkWare job revenue · {data.month.label} through {commercialDate(data.month.through)}.</p></article>
      <article><h4>Payments Recorded</h4><strong>{amount(data.reconciliation.recordedPayments?.total)}</strong><p>Payments entered for jobs · Selected day, {commercialDate(date)}; timing can differ from job revenue.</p></article>
      <article><h4>QuickBooks Income</h4><strong>{amount(income)}</strong><p>Accounting income · {comparable ? `Through ${commercialDate(through!)}, ${records[0].basis} basis` : 'No comparable QuickBooks reporting period available'}; accounting timing can differ.</p></article>
    </div>
  </section>;
}
