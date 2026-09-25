import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { OperatingTrends } from '../operating-trends';
import { shiftDay, scopeMetrics, type AnalyticsScope, type OperatingTrendsData } from '../../lib/operating-trends';
import '../app/globals.css';
import '../finance-trends.css';
import { ActionHints } from '../action-hints';
import FinanceTrends from '../finance-trends';
import type { FinanceData } from '../lib/commercial-contract';

// Synthetic layout fixture; no provider calls or company data.
const data: OperatingTrendsData = {
  generatedAt: '2026-09-25T15:00:00Z', snapshotDate: '2026-09-25', historyThrough: '2026-09-24',
  wexCoverage: { status: 'partial', records: 30, coverageFrom: '2026-08-16', coverageThrough: '2026-09-20', updatedAt: '2026-09-22T15:00:00Z', note: 'Synthetic fixture' },
  daily: Array.from({ length: 100 }, (_, i) => {
    const date = shiftDay('2026-09-24', i - 99), value = 20 + i % 7 * 3;
    const wex = date >= '2026-08-16' && date <= '2026-09-20' && i % 7 !== 0;
    const closed = i % 7 === 0;
    return { date, jobDay: closed ? 'zero' : 'operating', revenue: i === 88 ? null : closed ? 0 : value * 100, completedJobs: closed ? 0 : i % 7 + 5, recordedFuel: value * 4, wexCost: wex ? value * 3.4 : null, gallons: wex ? value : null, netPerGallon: wex ? 3.4 : null, dumpCost: value * 5, dumpAndFuel: value * 9, adCost: value * 15, calls: value, conversions: value / 3, costPerCall: 15, reviews: i % 4, averageRating: i % 4 ? 4 + i % 2 : null, miles: value * 8, averageJob: 300, operatingProfit: value * 60, scheduledAppointments: i % 7 + 8, labor: value * 20 };
  }),
  forecasts: (['revenue', 'completedJobs', 'fuelCost', 'fuelGallons', 'dumpCost'] as const).map((target, i) => ({
    target, unit: target === 'completedJobs' ? 'count' : target === 'fuelGallons' ? 'gallons' : 'usd',
    method: 'same-weekday trailing baseline', dataThrough: '2026-09-24', historyObservations: 90,
    backtest: { observations: 40, meanAbsoluteError: 10, weightedAbsolutePercentError: .4 },
    points: Array.from({ length: 7 }, (_, j) => ({ date: shiftDay('2026-09-25', j), value: (i === 0 ? 3000 : i === 1 ? 10 : i === 3 ? 30 : 100) * (1 + j / 10), expectedLow: i === 0 ? 2000 : 5, expectedHigh: i === 0 ? 5000 : i === 1 ? 20 : 200, confidence: 'low', trainingObservations: 8 })),
  })),
};
const finance = { date: '2026-09-25', daily: { revenue: 1200 }, operatingTrends: data, trends: [{ monthKey: '2026-09', monthDisplay: 'September 2026', dataThroughDate: '2026-09-25', grossRevenue: 60000, completedJobs: 240, complete: false, revenueSource: 'junkware-monthly-dashboard', revenueCovered: true }] } as FinanceData;
function Fixture() { const [scope, setScope] = useState<AnalyticsScope | 'monthly'>('business'); return <div className="ops-live"><ActionHints /><main className="finance-performance" style={{ maxWidth: 1300, margin: '20px auto' }}><h2>Synthetic operating chart fixture</h2><nav aria-label="Chart page fixture">{[...Object.keys(scopeMetrics), 'monthly'].map(key => <button key={key} onClick={() => setScope(key as AnalyticsScope | 'monthly')} style={{ padding: 12 }}>{key}</button>)}<button data-action-hint="Open graph & see data">Command card hint fixture</button></nav>{scope === 'monthly' ? <FinanceTrends data={finance} hideCharts /> : <OperatingTrends key={scope} data={data} scope={scope} />}</main></div>; }
createRoot(document.getElementById('root')!).render(<Fixture/>);
