import { withSavedCloseoutTruck } from './command-closeout-truck';
import { assumedDumpExpenseAlerts } from './dump-expenses';
import { truckExpenseTimelineAlerts, mergeTruckExpenseAlerts } from './truck-expense-notifications';
import { readEstimateSummary } from './estimate-follow-up';
import { streamlineOperationalAlerts } from './streamlined-operational-alerts';
import { appointmentVisitAlerts } from './appointment-visit-alerts';
import { buildCrewProgress } from './crew-progress';
import { crewAppointmentFacts } from './crew-progress-details';
import { sourceFreshness } from './source-freshness';
import { appointmentOnsiteTime, onsiteTimeFacts } from './appointment-onsite-time';
import { readScheduleVisits } from './desktop-schedule-visits';
import { geofenceTimelineAlerts, readGeofenceEntries } from './linxup-geofence-alerts';
import {truckLoadTrackingAlerts} from './truck-load-tracking-alerts';
import { readJobRows } from './desktop-schedule-source';
import { readDesktopSourceHealth } from '@/lib/desktop-source-health';
import { readMetrics, money, type AnyRecord } from '@/lib/opsData';
import { buildCommandMapData, summarizeCommandSchedule } from '@/lib/command-map-data';
import { dailyRevenueTarget, operatingTargets } from '@/lib/operating-targets';
import { readSlackDailyDigest } from '@/lib/slack-digest';
import { combinedCloseoutAlerts } from '@/lib/combined-closeout-alerts';
import { readCommandCrewCorrections } from './command-crew-corrections';
import { buildDailyPaymentReconciliation } from '@/lib/payment-reconciliation';
import { readCompletedJunkwareRows } from '@/lib/slack-closeout-details';
import { buildDailyFinanceSummary } from '@/lib/daily-finance-summary';
import { readWexFuelFinance, type WexFuelFinanceData } from '@/lib/wex-fuel';
import { commandAlertState, commandAlertWorkItemForSource } from '@/lib/command-alert-workflow';
import { listCommandAlertWorkItems } from '@/lib/platform/persistence/work-items';
import type { WorkItem } from '@/lib/platform/contracts';
import type { DesktopKpi, DesktopCommandSnapshot } from '../desktop-ui/lib/live-contract';

const progress = (actual: number | null, target: number) => actual == null || target <= 0 ? 0 : Math.max(0, Math.min(100, actual / target * 100));
const amount = (value: number | null) => value == null ? '—' : money(value);
const tone = (value: number | null, target: number): DesktopKpi['tone'] => value == null || target <= 0 ? 'warning' : value >= target ? 'healthy' : 'critical';

// Keep the daily metrics together; missing evidence is not zero.
export function desktopCommandKpis(metrics: AnyRecord | null, schedule: ReturnType<typeof summarizeCommandSchedule> | null, _visibleTrucks: number, wex?: WexFuelFinanceData): DesktopKpi[] {
  const finance = buildDailyFinanceSummary(metrics, wex);
  const plan = dailyRevenueTarget();
  const payrollPercent = finance.labor != null && finance.revenue != null && finance.revenue > 0 ? finance.labor / finance.revenue * 100 : null;
  const scheduleCount = schedule?.scheduled || 0;
  return [
    { label: 'Today’s jobs', value: schedule ? String(schedule.scheduled) : '—', detail: schedule ? `${schedule.completedJobs} completed jobs · ${schedule.closedEstimates} closed estimates · ${schedule.unclosed} open` : 'Schedule source unavailable', progress: schedule ? 100 : 0, tone: schedule && schedule.unclosed === 0 ? 'healthy' : 'warning', segments: schedule ? [
      { label: 'Completed Jobs', value: progress(schedule.completedJobs, scheduleCount), tone: 'healthy' },
      { label: 'Closed Estimates', value: progress(schedule.closedEstimates, scheduleCount), tone: 'warning' },
      { label: 'Unclosed', value: progress(schedule.unclosed, scheduleCount), tone: 'critical' },
    ] : undefined },
    { label: 'Revenue', value: amount(finance.revenue), detail: finance.revenue == null ? 'Revenue source unavailable' : `${Math.round(finance.revenue / plan * 100)}% of ${money(plan)}`, progress: progress(finance.revenue, plan), tone: tone(finance.revenue, plan) },
    { label: 'Labor', value: amount(finance.labor), secondaryValue: payrollPercent == null ? undefined : `${payrollPercent.toFixed(1)}% of revenue`, detail: payrollPercent == null ? 'Labor source unavailable' : `Goal: under ${operatingTargets.maxPayrollPercent}%`, progress: progress(payrollPercent, operatingTargets.maxPayrollPercent), tone: payrollPercent == null ? 'warning' : payrollPercent < operatingTargets.maxPayrollPercent ? 'healthy' : 'critical' },
    { label: 'Dump + Fuel', value: finance.dumps == null || finance.fuel == null ? '—' : amount(finance.dumps + finance.fuel), secondaryValue: `Dumps ${amount(finance.dumps)} · Fuel ${amount(finance.fuel)}`, detail: finance.fuelSource === 'wex' ? 'Fuel from posted WEX transactions' : finance.dumps == null || finance.fuel == null ? 'Expense source incomplete' : 'Published daily expenses', progress: finance.dumps == null || finance.fuel == null ? 0 : 100, tone: finance.dumps == null || finance.fuel == null ? 'warning' : 'healthy' },
    { label: 'Net', value: amount(finance.net), detail: finance.net == null ? 'Net source unavailable' : 'After all recorded daily costs', progress: finance.net == null || finance.revenue == null || finance.revenue <= 0 ? 0 : progress(finance.net, finance.revenue), tone: finance.net == null ? 'warning' : finance.net >= 0 ? 'healthy' : 'critical' },
  ];
}

export async function readDesktopCommand(date: string, actor: DesktopCommandSnapshot['actor']): Promise<DesktopCommandSnapshot> {
  const metrics = readMetrics(date);
  const wexFuel = readWexFuelFinance(date);
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
  const alerts: DesktopCommandSnapshot['alerts'] = mergeTruckExpenseAlerts([...streamlineOperationalAlerts(appointmentVisitAlerts(combinedCloseoutAlerts(digest.messages, readCompletedJunkwareRows(date), buildDailyPaymentReconciliation(date), readCommandCrewCorrections(date,actor.role)), visits,appointments,date),appointments,date),...geofenceTimelineAlerts(date,geofences.arrivals,geofences.visits),...truckLoadTrackingAlerts(date),...assumedDumpExpenseAlerts(date)],truckExpenseTimelineAlerts(date)).map(alert => {
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
          alert = {...alert,needsAction:!/^Truck\s*#?\s*\d+/i.test(candidates[0].truck),facts:[...customerFacts.map(fact => {
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
      if (['Job Closed', 'Estimate Closed', 'Job Completed', 'Estimate Completed'].includes(alert.label)) {
        const jk = alert.title.match(/\bJK\d+\b/i)?.[0]?.toUpperCase();
        const candidates = appointments.filter(job => job.jkNumber.toUpperCase() === jk && (/estimate/i.test(job.appointmentType) === /estimate/i.test(alert.label)));
        alert = withSavedCloseoutTruck(alert, candidates);
        // Fold physical visit evidence even if the assignment changed later.
        const time = candidates.length === 1 ? appointmentOnsiteTime({...candidates[0],truck:''}, visits) : {minutes:null,arrival:null,departure:null,label:'Unavailable · appointment match needed'};
        const visitTrucks = candidates.length === 1 ? [...new Set(visits.filter(visit=>String(visit.appointment_id || visit.appt_id || '') === candidates[0].appointmentId && visit.match_confidence === 'confirmed' && !visit.pass_by_only)
          .map(visit=>String(visit.truck_number || visit.truck || '').match(/\d+/)?.[0]).filter(Boolean))] : [];
        const visitingTruck = visitTrucks.length === 1 && visitTrucks[0] !== candidates[0]?.truck.match(/\d+/)?.[0] ? [{label:'Visited by',value:`Truck ${visitTrucks[0]}`}] : [];
        alert = {...alert, facts:[...alert.facts.filter(f=>!/^On-site time$|^Duration$|^Arrival$|^Departure$|^Visited by$/i.test(f.label)), ...onsiteTimeFacts(time),...visitingTruck]};
      }
      return {
        ...alert, timestamp: alert.timestamp,
        priority: ['New Appointment','Arrival','Departure','Duration','Job Closed','Estimate Closed','Job Completed','Estimate Completed','Photos Uploaded','Payment Recorded','Clock In','Clock Out','Final Daily Pay','Fuel Receipt','Dump Receipt','Receipt Recorded'].includes(alert.label) ? 'watch' : alert.needsAction ? 'warning' : 'watch',
        detail: '', source: alert.source || 'Slack', action: 'Open Source', context: alert.next,
        workflowState: action ? commandAlertState(action) : alert.resolved ? 'resolved' : 'active', version: action?.version || 0, actionId: action?.id,
      };
  }
  const crewProgress = buildCrewProgress({date,appointments,visits,alerts,
      scheduleCurrent: sourceHealth.some(source => source.name === 'JunkWare' && source.tone === 'healthy' && sourceFreshness(source.observedAt,source.maxAgeSeconds).fresh),
      visitsCurrent: sourceFreshness(visitSnapshot.observedAt,180).fresh,
      updatesComplete: digest.status === 'ready' && digest.complete !== false && geofences.complete,
    });
  for (const job of crewProgress.jobs.filter(job=>job.needsFollowUp)) {
    const latest = [...alerts].sort((a,b)=>(b.timestamp || '').localeCompare(a.timestamp || '')).find(alert=>job.updateIds.includes(alert.id));
    if (latest) latest.needsAction = true;
  }
  return {
    date, generatedAt: new Date().toISOString(), actor,
    kpis: desktopCommandKpis(metrics, map ? summarizeCommandSchedule(map.jobs) : null, map?.truckLocations.length || 0, wexFuel),
    sourceHealth: [...sourceHealth,
      {name:'LinxUp geofences',area:'Facility entries and automatic load resets',workspace:'Fleet',action:'Open Fleet',state:geofences.available ? geofences.complete ? 'Available' : 'Incomplete' : 'Unavailable',tone:geofences.available && geofences.complete ? 'healthy' : 'warning',observedAt:geofences.observedAt || null,maxAgeSeconds:180},
      {name:'Slack',area:'Operational alerts',workspace:'Command',action:'Open alerts',state:digest.status==='ready'?(digest.complete === false ? 'Incomplete' : 'Current'):'Unavailable',tone:digest.status==='ready' && digest.complete !== false ?'healthy':'warning',observedAt:digest.refreshedAt,maxAgeSeconds:120},
      {name:'Control',area:'Shared database connection',workspace:'Command',action:'Open decisions',state:workflow.available?'Connected':'Unavailable',tone:workflow.available?'healthy':'warning',observedAt:new Date().toISOString(),maxAgeSeconds:120}],
    sources: { metrics: Boolean(metrics), alerts: digest.status === 'ready' || geofences.available, workflow: workflow.available },
    alerts,
    crewProgress,
    estimates: readEstimateSummary(),

  };
}
