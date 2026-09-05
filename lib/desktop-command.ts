import { readDesktopSourceHealth } from '@/lib/desktop-source-health';
import { readMetrics, completedJobs, crewRows, truckRows, money, type AnyRecord } from '@/lib/opsData';
import { workedOrAttributedToJobToday } from '@/lib/crew-attendance';
import { buildCommandMapData, summarizeCommandSchedule } from '@/lib/command-map-data';
import { dailyRevenueTarget, operatingTargets } from '@/lib/operating-targets';
import { readSlackDailyDigest } from '@/lib/slack-digest';
import { toOperationalAlert } from '@/lib/operational-alert-presentation';
import { commandAlertState } from '@/lib/command-alert-workflow';
import { listCommandAlertWorkItems } from '@/lib/platform/persistence/work-items';
import type { WorkItem } from '@/lib/platform/contracts';
import type { DesktopKpi, DesktopCommandSnapshot } from '../desktop-ui/lib/live-contract';

function number(value: unknown): number | null {
  if (value == null || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}
const progress = (actual: number | null, target: number) => actual == null || target <= 0 ? 0 : Math.max(0, Math.min(100, actual / target * 100));
const amount = (value: number | null) => value == null ? '—' : money(value);
const count = (value: number | null) => value == null ? '—' : String(value);
const tone = (value: number | null, target: number): DesktopKpi['tone'] => value == null || target <= 0 ? 'warning' : value >= target ? 'healthy' : 'critical';

// The cards retain the approved labels and layout; missing evidence is not zero.
export function desktopCommandKpis(metrics: AnyRecord | null, schedule: ReturnType<typeof summarizeCommandSchedule> | null, visibleTrucks: number): DesktopKpi[] {
  const crew = metrics ? crewRows(metrics) : [];
  const trucks = metrics ? truckRows(metrics) : [];
  const activeCrew = metrics ? crew.filter(row => workedOrAttributedToJobToday(row)).length : null;
  const activeTrucks = metrics ? trucks.filter(truck => Number(truck.revenue) > 0).length : null;
  const revenue = number(metrics?.total_revenue ?? metrics?.gross_revenue);
  const payroll = number(metrics?.total_payroll ?? metrics?.payroll);
  const profit = number(metrics?.net_profit);
  const jobs = metrics ? completedJobs(metrics) : null;
  const plan = dailyRevenueTarget();
  const jobsGoal = plan / operatingTargets.averageJobSize;
  const revenuePerTruck = revenue != null && activeTrucks ? revenue / activeTrucks : null;
  const revenuePerTruckGoal = activeTrucks ? plan / activeTrucks : 0;
  const profitPerJob = profit != null && jobs ? profit / jobs : null;
  const profitPerJobGoal = operatingTargets.averageJobSize * operatingTargets.minOperatingMarginPercent / 100;
  const payrollPercent = payroll != null && revenue != null && revenue > 0 ? payroll / revenue * 100 : null;
  const totalTrucks = Math.max(visibleTrucks, trucks.length);
  const scheduleCount = schedule?.scheduled || 0;
  return [
    { label: 'Completed jobs', value: count(jobs), detail: `Goal: ${jobsGoal.toFixed(1)} jobs`, progress: progress(jobs, jobsGoal), tone: tone(jobs, jobsGoal) },
    { label: 'Active trucks', value: count(activeTrucks), detail: activeTrucks == null ? 'Source unavailable' : `${activeTrucks} of ${totalTrucks} producing revenue`, progress: progress(activeTrucks, totalTrucks), tone: activeTrucks ? 'healthy' : 'warning' },
    { label: 'Revenue / truck', value: amount(revenuePerTruck), detail: revenuePerTruckGoal ? `Goal: ${money(revenuePerTruckGoal)}` : 'Waiting for producing trucks', progress: progress(revenuePerTruck, revenuePerTruckGoal), tone: tone(revenuePerTruck, revenuePerTruckGoal) },
    { label: 'Profit / job', value: amount(profitPerJob), detail: `Goal: ${money(profitPerJobGoal)}`, progress: progress(profitPerJob, profitPerJobGoal), tone: tone(profitPerJob, profitPerJobGoal) },
    { label: 'Today’s jobs', value: schedule ? String(schedule.scheduled) : '—', detail: schedule ? `${schedule.completedJobs} completed jobs · ${schedule.closedEstimates} closed estimates · ${schedule.unclosed} open` : 'Schedule source unavailable', progress: schedule ? 100 : 0, tone: schedule && schedule.unclosed === 0 ? 'healthy' : 'warning', segments: schedule ? [
      { label: 'Completed Jobs', value: progress(schedule.completedJobs, scheduleCount), tone: 'healthy' },
      { label: 'Closed Estimates', value: progress(schedule.closedEstimates, scheduleCount), tone: 'warning' },
      { label: 'Unclosed', value: progress(schedule.unclosed, scheduleCount), tone: 'critical' },
    ] : undefined },
    { label: 'Revenue plan', value: amount(revenue), detail: revenue == null ? 'Revenue source unavailable' : `${Math.round(revenue / plan * 100)}% of ${money(plan)}`, progress: progress(revenue, plan), tone: tone(revenue, plan) },
    { label: 'Labor', value: amount(payroll), detail: payrollPercent == null ? 'Percentage unavailable · Waiting for source' : `${payrollPercent.toFixed(1)}% current · Goal: under ${operatingTargets.maxPayrollPercent}%`, progress: progress(payrollPercent, operatingTargets.maxPayrollPercent), tone: payrollPercent == null ? 'warning' : payrollPercent < operatingTargets.maxPayrollPercent ? 'healthy' : 'critical' },
    { label: 'Crew coverage', value: count(activeCrew), detail: 'Clocked in or attributed to jobs', progress: progress(activeCrew, crew.length), tone: activeCrew ? 'healthy' : 'warning' },
  ];
}

export async function readDesktopCommand(date: string, actor: DesktopCommandSnapshot['actor']): Promise<DesktopCommandSnapshot> {
  const metrics = readMetrics(date);
  const map = metrics ? buildCommandMapData(date) : null;
  const [digest, workflow] = await Promise.all([
    readSlackDailyDigest(date),
    listCommandAlertWorkItems(date).then(items => ({ available: true, items })).catch(() => ({ available: false, items: [] as WorkItem[] })),
  ]);
  const actions = new Map(workflow.items.map(item => [item.entity.id, item]));
  return {
    date, generatedAt: new Date().toISOString(), actor,
    kpis: desktopCommandKpis(metrics, map ? summarizeCommandSchedule(map.jobs) : null, map?.truckLocations.length || 0),
    sourceHealth: [...readDesktopSourceHealth(/^(admin|administrator|manager)$/i.test(actor.role)),
      {name:'Slack',area:'Operational alerts',workspace:'Command',action:'Open alerts',state:digest.status==='ready'?'Current':'Unavailable',tone:digest.status==='ready'?'healthy':'warning',observedAt:digest.refreshedAt,maxAgeSeconds:120},
      {name:'Control',area:'Shared database connection',workspace:'Command',action:'Open decisions',state:workflow.available?'Connected':'Unavailable',tone:workflow.available?'healthy':'warning',observedAt:new Date().toISOString(),maxAgeSeconds:120}],
    sources: { metrics: Boolean(metrics), alerts: digest.status === 'ready', workflow: workflow.available },
    alerts: digest.messages.map(message => {
      const alert = toOperationalAlert(message);
      const action = actions.get(message.id);
      return {
        id: alert.id, domain: alert.domain, priority: alert.label === 'Cancellation' ? 'critical' : alert.needsAction ? 'warning' : 'watch',
        title: alert.title, detail: '', label: alert.label, owner: alert.owner, detected: alert.detected,
        source: 'Slack', action: 'Open Source', context: alert.next, facts: alert.facts, href: alert.href,
        needsAction: alert.needsAction, workflowState: commandAlertState(action), version: action?.version || 0, actionId: action?.id,
      };
    }),
  };
}
