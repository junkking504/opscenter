import { consolidateConfirmedVisitAlerts } from './confirmed-visit-alerts';
import { buildCrewProgress } from './crew-progress';
import { crewAppointmentFacts } from './crew-progress-details';
import { sourceFreshness } from './source-freshness';
import { appointmentOnsiteTime, onsiteTimeFacts } from './appointment-onsite-time';
import { readScheduleVisits } from './desktop-schedule-visits';
import { geofenceOperationalAlert, readGeofenceEntries } from './linxup-geofence-alerts';
import { readJobRows } from './desktop-schedule-source';
import { readDesktopSourceHealth } from '@/lib/desktop-source-health';
import { readMetrics, completedJobs, crewRows, truckRows, money, type AnyRecord } from '@/lib/opsData';
import { workedOrAttributedToJobToday } from '@/lib/crew-attendance';
import { buildCommandMapData, summarizeCommandSchedule } from '@/lib/command-map-data';
import { dailyRevenueTarget, operatingTargets } from '@/lib/operating-targets';
import { readSlackDailyDigest } from '@/lib/slack-digest';
import { combinedCloseoutAlerts } from '@/lib/combined-closeout-alerts';
import { readCommandCrewCorrections } from './command-crew-corrections';
import { buildDailyPaymentReconciliation } from '@/lib/payment-reconciliation';
import { readCompletedJunkwareRows } from '@/lib/slack-closeout-details';
import { commandAlertState, commandAlertWorkItemForSource } from '@/lib/command-alert-workflow';
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
  const visitSnapshot = readScheduleVisits(date);
  const visits = visitSnapshot.visits;
  const appointments = readJobRows(date);
  const sourceHealth = readDesktopSourceHealth(/^(admin|administrator|manager)$/i.test(actor.role));
  const geofences = readGeofenceEntries(date);
  const alerts: DesktopCommandSnapshot['alerts'] = [...consolidateConfirmedVisitAlerts(combinedCloseoutAlerts(digest.messages, readCompletedJunkwareRows(date), buildDailyPaymentReconciliation(date), readCommandCrewCorrections(date,actor.role)), visits),...geofences.entries.map(entry=>geofenceOperationalAlert(entry,date))].map(alert => {
      const action = commandAlertWorkItemForSource(workflow.items, alert);
      return presentAlert(alert, action);
  });
  function presentAlert(alert: ReturnType<typeof combinedCloseoutAlerts>[number], action?: WorkItem): DesktopCommandSnapshot['alerts'][number] {
      if (alert.label === 'New Appointment') {
        const reference = alert.title.match(/\bJK\d+\b/i)?.[0]?.toUpperCase();
        const candidates = appointments.filter(job => job.jkNumber.toUpperCase() === reference);
        if (candidates.length === 1) {
          const customerFacts = crewAppointmentFacts(candidates[0]);
          // Preserve source-only details when the current appointment snapshot is
          // missing a field, and show notes/items without truncation.
          alert = {...alert,facts:[...customerFacts.map(fact => {
            const source = alert.facts.find(old=>old.label.toLowerCase() === fact.label.toLowerCase() || fact.label === 'Pickup items' && old.label === 'Items');
            return source && /^(Not provided|Unavailable|Not listed|No notes available)$/.test(fact.value) ? {...fact,value:source.value,href:source.href} : fact;
          }),...alert.facts.filter(fact=>!['customer','phone','email','service address','items','pickup items','appointment notes'].includes(fact.label.toLowerCase()))]};
        }
      }
      if (alert.label === 'Photos Uploaded') {
        const reference = alert.title.match(/\bJK\d+\b/i)?.[0]?.toUpperCase();
        const candidates = appointments.filter(job => job.jkNumber.toUpperCase() === reference);
        if (candidates.length === 1 && candidates[0].photos.length) alert = {...alert,photos:candidates[0].photos};
      }
      if (['Job Closed', 'Estimate Closed'].includes(alert.label)) {
        const jk = alert.title.match(/\bJK\d+\b/i)?.[0]?.toUpperCase();
        const candidates = appointments.filter(job => job.jkNumber.toUpperCase() === jk && (/estimate/i.test(job.appointmentType) === (alert.label === 'Estimate Closed')));
        const time = candidates.length === 1 ? appointmentOnsiteTime(candidates[0], visits) : {minutes:null,arrival:null,departure:null,label:'Unavailable · appointment match needed'};
        alert = {...alert, facts:[...alert.facts.filter(f=>!/^On-site time$|^Arrival$|^Departure$/i.test(f.label)), ...onsiteTimeFacts(time)]};
      }
      return {
        ...alert, timestamp: alert.timestamp,
        priority: ['New Appointment','Arrival','Departure','Duration','Job Closed','Estimate Closed','Photos Uploaded','Payment Recorded','Clock In','Clock Out','Final Daily Pay','Fuel Receipt','Dump Receipt','Receipt Recorded'].includes(alert.label) ? 'watch' : alert.needsAction ? 'warning' : 'watch',
        detail: '', source: alert.source || 'Slack', action: 'Open Source', context: alert.next,
        workflowState: commandAlertState(action), version: action?.version || 0, actionId: action?.id,
      };
  }
  return {
    date, generatedAt: new Date().toISOString(), actor,
    kpis: desktopCommandKpis(metrics, map ? summarizeCommandSchedule(map.jobs) : null, map?.truckLocations.length || 0),
    sourceHealth: [...sourceHealth,
      {name:'LinxUp geofences',area:'Facility entries and automatic load resets',workspace:'Fleet',action:'Open Fleet',state:geofences.available ? geofences.complete ? 'Available' : 'Incomplete' : 'Unavailable',tone:geofences.available && geofences.complete ? 'healthy' : 'warning',observedAt:geofences.observedAt || null,maxAgeSeconds:180},
      {name:'Slack',area:'Operational alerts',workspace:'Command',action:'Open alerts',state:digest.status==='ready'?(digest.complete === false ? 'Incomplete' : 'Current'):'Unavailable',tone:digest.status==='ready' && digest.complete !== false ?'healthy':'warning',observedAt:digest.refreshedAt,maxAgeSeconds:120},
      {name:'Control',area:'Shared database connection',workspace:'Command',action:'Open decisions',state:workflow.available?'Connected':'Unavailable',tone:workflow.available?'healthy':'warning',observedAt:new Date().toISOString(),maxAgeSeconds:120}],
    sources: { metrics: Boolean(metrics), alerts: digest.status === 'ready' || geofences.available, workflow: workflow.available },
    alerts,
    crewProgress: buildCrewProgress({date,appointments,visits,alerts,
      scheduleCurrent: sourceHealth.some(source => source.name === 'JunkWare' && source.tone === 'healthy' && sourceFreshness(source.observedAt,source.maxAgeSeconds).fresh),
      visitsCurrent: sourceFreshness(visitSnapshot.observedAt,180).fresh,
      updatesComplete: digest.status === 'ready' && digest.complete !== false && geofences.complete,
    }),
  };
}
