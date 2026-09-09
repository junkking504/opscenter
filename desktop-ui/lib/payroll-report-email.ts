import { payrollReviewCsv, type PayrollReviewRow } from './payroll-review';

/** Recipients explicitly selected for payroll reporting. No delivery occurs here. */
export const PAYROLL_REPORT_RECIPIENTS = [
  'eugene.dabezies@junk-king.com',
  'branden.dozier@junk-king.com',
  'robert.mclaughlin@junk-king.com',
] as const;

export function preparePayrollReportEmail(input: {
  rows: PayrollReviewRow[]; start: string; end: string; retrievedAt: string;
  totalEmployeeCount: number; warnings: string[];
}) {
  if (!input.rows.length) throw new Error('Review at least one employee before preparing the report.');
  if (input.totalEmployeeCount < input.rows.length) throw new Error('Employee scope is invalid.');
  const csv = payrollReviewCsv({ ...input, reviewed: true });
  const omitted = input.totalEmployeeCount - input.rows.length;
  const money = (value: number | null) => value === null ? 'Unavailable' : value.toLocaleString('en-US', { style: 'currency', currency: 'USD' });
  const hrs = (value: number | null) => value === null ? 'Unavailable' : value.toFixed(2);
  const text = [
    `Krewe payroll report: ${input.start} through ${input.end}`,
    '',
    `${input.rows.length} of ${input.totalEmployeeCount} employees reviewed.`,
    ...(omitted ? [`PARTIAL REPORT: ${omitted} unreviewed employees are excluded. This is not the complete payroll.`] : []),
    'Amounts are before deductions. This report does not submit payroll or authorize payment.',
    `Source snapshot retrieved: ${input.retrievedAt}`,
    '',
    ...input.rows.flatMap(row => [
      row.name,
      `Hours: Week 1 ${hrs(row.weeks[0]?.hours ?? null)}; Week 2 ${hrs(row.weeks[1]?.hours ?? null)}; regular ${hrs(row.regular)}; overtime ${hrs(row.overtime)}.`,
      `Hourly pay ${money(row.pay.labor)} | Tips ${money(row.pay.tips)} | Bonuses ${money(row.pay.bonuses)} | Supplemental ${money(row.pay.supplemental)} | Total ${money(row.pay.totalPay)}`,
      '',
    ]),
    `Review source days in OpsCenter: https://ops.junk-king.app/desktop?data=live&workspace=Krewe&kreweView=payperiod&date=${input.start}`,
  ].join('\n');
  return { to: [...PAYROLL_REPORT_RECIPIENTS], subject: `${omitted ? 'PARTIAL ' : ''}Krewe payroll report | ${input.start} – ${input.end}`, text, attachment: { filename: `krewe-payroll-${input.start}-${input.end}-reviewed.csv`, content: csv, contentType: 'text/csv; charset=utf-8' } };
}
