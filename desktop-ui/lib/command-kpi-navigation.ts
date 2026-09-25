import type { AnalyticsScope, OperatingMetric } from '../../lib/operating-trends';

export type CommandKpiDestination = { workspace: 'Schedule' | 'Krewe' | 'Finance'; scope: AnalyticsScope; metric: OperatingMetric; financeView?: 'expenses' | 'trends' };
export function commandKpiDestination(label: string): CommandKpiDestination | null {
  if (label === 'Today’s jobs' || label === 'Day’s jobs') return { workspace: 'Schedule', scope: 'jobs', metric: 'scheduledAppointments' };
  if (label === 'Completed jobs') return { workspace: 'Schedule', scope: 'jobs', metric: 'completedJobs' };
  if (label === 'Revenue') return { workspace: 'Finance', scope: 'business', metric: 'revenue', financeView: 'trends' };
  if (label === 'Labor') return { workspace: 'Krewe', scope: 'labor', metric: 'labor' };
  if (label === 'Dump + Fuel') return { workspace: 'Finance', scope: 'expenses', metric: 'dumpAndFuel', financeView: 'expenses' };
  if (label === 'Net' || label === 'Net Revenue') return { workspace: 'Finance', scope: 'business', metric: 'operatingProfit', financeView: 'trends' };
  return null;
}
