import React from 'react';
import { createRoot } from 'react-dom/client';
import FinanceTrends from '../finance-trends';
import type { FinanceData } from '../lib/commercial-contract';
import { financeTrendComparisons } from '../../lib/finance-trend-comparison';
import '../app/globals.css';
import '../live-responsive.css';
import '../workspace-density.css';
const trends: FinanceData['trends'] = [2025, 2026].flatMap(year => Array.from({ length: year === 2025 ? 8 : 9 }, (_, index) => {
  const key = `${year}-${String(index + 1).padStart(2, '0')}`;
  const partial = index === 8;
  const sales = 12000 + index * 1000;
  return { monthKey: key, monthDisplay: new Date(`${key}-01T12:00:00Z`).toLocaleDateString('en-US', { month: 'long', year: 'numeric' }), complete: !partial, reportingComplete: !partial, dataThroughDate: `${key}-${partial ? '11' : String(new Date(Date.UTC(year, index + 1, 0)).getUTCDate())}`, grossRevenue: sales + (year === 2026 ? 1500 : 0), completedJobs: 40 + index, revenueSource: 'junkware-monthly-dashboard', operatingRevenue: partial ? null : sales, recyclingIncome: partial ? null : 0, totalOperatingExpenses: partial ? null : sales * .4, estimatedOperatingProfit: partial ? null : sales * .6, missingDates: partial ? ['2026-09-07'] : [] };
}));
const data = { date: '2026-09-11', trends, trendComparisons: financeTrendComparisons(trends, () => null) } as FinanceData;
createRoot(document.getElementById('root')!).render(<main className="ops-live" style={{ padding: 16 }}><FinanceTrends data={data} /></main>);
