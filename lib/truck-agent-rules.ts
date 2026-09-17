import { createHash } from 'node:crypto';
import { agentTruckNumber, agentFleetHref, agentScheduleHref, type TruckAgent, type TruckRecommendation, type AgentEvidence, type AgentPriority } from '../desktop-ui/lib/truck-agent-contract';

export type AgentSource<T> = { available: boolean; observedAt: string | null; note: string; data: T };
export type AgentJob = { id: string; number: string; truck: string; status: string; crew: string; end: number | null; time: string; photosMissing: boolean; chargesPending: boolean };
export type AgentRepair = { id: string; truck: string; title: string; status: string; severity: string; owner: string; due: string; at: string };
export type AgentInspection = { truck: string; at: string; href: string; status: string; fuel: string; odometer: string; findings: string[] };
export type TruckAgentInputs = {
  identity: AgentSource<Array<{ truck: string; tracker: string }>>;
  repairs: AgentSource<AgentRepair[]>;
  maintenance: AgentSource<Array<{ truck: string; id: string; status: string; date: string; type: string; vendor: string; at: string }>>;
  inspections: AgentSource<AgentInspection[]>;
  schedule: AgentSource<AgentJob[]>;
  gps: AgentSource<Array<{ truck: string; at: string | null; speed: number | null; ignition: string }>>;
  loads: AgentSource<Array<{ truck: string; label: string; percent: number | null; at: string | null; uncertain: boolean; note: string }>>;
  visits: AgentSource<Array<{ truck: string; name: string; entered: string; departed: string | null }>>;
  costs: AgentSource<Array<{ id: string; truck: string; note: string; at: string | null }>>;
};
export const agentHash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
export const agentFresh = (at: string | null, now: number, seconds = 180) => { const age = (now - Date.parse(at || '')) / 1000; return Number.isFinite(age) && age >= -60 && age <= seconds; };
export const agentDay = (now: number) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago' }).format(now);
const minuteOfDay = (now: number) => { const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Chicago', hour: 'numeric', minute: 'numeric', hourCycle: 'h23' }).formatToParts(now); return Number(parts.find(p => p.type === 'hour')?.value) * 60 + Number(parts.find(p => p.type === 'minute')?.value); };
const complete = (status: string) => /complet|closed/i.test(status);
const canceled = (status: string) => /cancel|no.?show/i.test(status);
const priorities = { urgent: 0, next: 1, watch: 2 };

/** Pure, truck-scoped advisory projection. Never certifies readiness or writes source records. */
export function assessTruck(n: number, date: string, input: TruckAgentInputs, now: number, prior?: TruckAgent): TruckAgent {
  const truck = `Truck ${n}`, stamp = new Date(now).toISOString(), fleet = agentFleetHref(date, n);
  const forTruck = <T extends { truck: string }>(rows: T[]) => rows.filter(row => agentTruckNumber(row.truck) === n);
  const repairs = forTruck(input.repairs.data), openRepairs = repairs.filter(r => r.status !== 'resolved');
  const inspections = forTruck(input.inspections.data).filter(r => Date.parse(r.at) <= now + 60_000).sort((a, b) => b.at.localeCompare(a.at));
  const inspection = inspections.find(r => agentDay(Date.parse(r.at)) === date && r.status !== 'stop_disposed'), stop = inspections.find(r => r.status === 'stop');
  const jobs = forTruck(input.schedule.data).filter(j => !canceled(j.status));
  const openJobs = jobs.filter(j => !complete(j.status));
  const gps = forTruck(input.gps.data)[0], load = forTruck(input.loads.data)[0];
  const today = date === agentDay(now), scheduleCurrent = input.schedule.available && (!today || agentFresh(input.schedule.observedAt, now, 120));
  const mapped = input.identity.available && forTruck(input.identity.data).length === 1;
  const recs: TruckRecommendation[] = [];
  const evidence = (source: keyof TruckAgentInputs, value: string, href = fleet, at = input[source].observedAt): AgentEvidence => ({ source, value, href, observedAt: at });
  function add(rule: string, subject: string, priority: AgentPriority, title: string, detail: string, facts: AgentEvidence[], owner = 'Dispatch', href = fleet, due: string | null = null) {
    const id = `truck-${n}:${date}:${rule}:${subject}`;
    // Collection heartbeat changes do not invalidate a review. Changed facts do.
    const version = agentHash({ id, priority, title, detail, owner, due, facts: facts.map(({ source, value, href }) => ({ source, value, href })) });
    const previous = prior?.recommendations.find(r => r.id === id);
    recs.push({ id, version, rule, priority, title, detail, evidence: facts, owner, href, due,
      firstSeenAt: previous?.firstSeenAt || stamp, changedAt: previous?.version === version ? previous.changedAt : stamp,
      review: null, reviewVersion: agentHash(null) });
  }
  if (!mapped) add('identity', 'truck', openJobs.length ? 'urgent' : 'next', 'Verify truck identity and availability', 'Confirm the fleet record and one effective tracker mapping before making location or capacity recommendations.', [evidence('identity', forTruck(input.identity.data).length > 1 ? 'Multiple effective tracker mappings' : 'No verified effective tracker mapping')]);
  for (const [source, value] of Object.entries(input)) if (!value.available) add('source', source, 'watch', `${source[0].toUpperCase() + source.slice(1)} evidence unavailable`, value.note || 'Retained observations remain historical. Check the owning source.', [evidence(source as keyof TruckAgentInputs, value.note || 'Source unavailable')]);
  if (today && !scheduleCurrent && input.schedule.available) add('schedule-freshness', 'schedule', 'next', 'Refresh appointment evidence', 'The retained schedule is too old for current assignment or delay decisions.', [evidence('schedule', 'Schedule observation exceeds two minutes')], 'Dispatch', agentScheduleHref(date));
  for (const repair of openRepairs) {
    const repairHref = agentFleetHref(date, n, 'maintenance');
    const restriction = repair.severity === 'out_of_service';
    const conflict = repairs.some(r => r.status === 'resolved' && r.title.trim().toLowerCase() === repair.title.trim().toLowerCase());
    const overdue = Boolean(repair.due && repair.due < date);
    add('repair', repair.id, restriction || overdue ? 'urgent' : 'next', conflict ? `Reconcile repair status: ${repair.title}` : `${restriction ? 'Return-to-service review' : 'Follow repair'}: ${repair.title}`,
      conflict ? 'Open and resolved records share this repair title. Review both; a resolved record cannot clear the remaining restriction.' : restriction ? 'An out-of-service repair remains open. Obtain repair completion evidence and an authorized return-to-service decision.' : `${inspection?.status === 'clear' ? 'A clear inspection does not close this repair. ' : ''}${!repair.owner || !repair.due ? 'Confirm the repair owner and planned date.' : 'Confirm progress and completion evidence.'}`,
      [evidence('repairs', `${repair.title} · ${repair.status} · ${repair.severity}${repair.owner ? ` · ${repair.owner}` : ''}`, repairHref, repair.at)], repair.owner || 'Fleet manager', repairHref, repair.due || null);
  }
  if (stop) add('inspection-stop', 'inspection', 'urgent', 'Review do-not-operate inspection', 'Review repair disposition for this stop report. A later clear inspection or new day cannot establish that the reported defect was repaired. Link its report reference in the resolved repair record.', [evidence('inspections', stop.findings.join('; ') || 'Do not operate', stop.href, stop.at)], 'Fleet manager', stop.href);
  else if (inspection && inspection.findings.length) add('inspection-defect', 'inspection', 'next', 'Follow inspection findings', 'Review the reported condition and link repair follow-through to the inspection.', [evidence('inspections', inspection.findings.join('; '), inspection.href, inspection.at)], 'Fleet manager', inspection.href);
  if (!inspection) add('inspection-missing', 'inspection', 'next', 'Obtain this day’s inspection', `${openJobs.length ? 'Assigned work has no current inspection evidence. ' : ''}Establish readiness before dispatch recommendations.`, [evidence('inspections', 'No inspection for the selected day', agentFleetHref(date, n, 'maintenance'))], 'Crew / dispatcher', agentFleetHref(date, n, 'maintenance'));
  if (inspection && /^(Empty|1\/4)$/i.test(inspection.fuel)) add('fuel', 'inspection', inspection.fuel === 'Empty' ? 'urgent' : 'next', 'Check fuel before the next route', 'Verify current fuel and any refueling since this inspection; the recorded level does not establish current range.', [evidence('inspections', `Fuel recorded: ${inspection.fuel}`, inspection.href, inspection.at)], 'Crew / dispatcher', inspection.href);
  if (inspection && Number(inspection.odometer.replace(/,/g, '')) >= 1_000_000) add('odometer', 'inspection', 'watch', 'Review inspection odometer', 'Verify the recorded odometer before using it for service planning.', [evidence('inspections', `Odometer recorded: ${inspection.odometer}`, inspection.href, inspection.at)], 'Fleet manager', inspection.href);
  for (const service of forTruck(input.maintenance.data).filter(r => r.status === 'scheduled' && r.date <= new Date(Date.parse(date + 'T12:00:00Z') + 7 * 86400000).toISOString().slice(0, 10))) add('service', service.id, service.date < date ? 'urgent' : service.date === date ? 'next' : 'watch', `Confirm scheduled service: ${service.type}`, 'A scheduled date does not prove the work occurred. Record its disposition and completion evidence.', [evidence('maintenance', `${service.type} · ${service.date}`, agentFleetHref(date, n, 'service'), service.at)], service.vendor || 'Fleet manager', agentFleetHref(date, n, 'service'), service.date);
  const recentLoad = load?.at && Number.isFinite(Date.parse(load.at)) && agentDay(Date.parse(load.at)) === date && Date.parse(load.at) <= now + 60_000;
  const loadUsable = Boolean(load && !load.uncertain && recentLoad && input.loads.available && input.inspections.available && scheduleCurrent);
  if (!loadUsable) add('capacity', 'load', openJobs.length ? 'next' : 'watch', 'Confirm available capacity', 'Use a current load observation and the existing pickup/unload evidence before offering capacity or recommending another job.', [evidence('loads', load ? `${load.label} · ${load.note}` : 'No supported load observation', fleet, load?.at || null)], 'Crew / dispatcher');
  else if (load && load.percent !== null && load.percent >= 90 && openJobs.length && scheduleCurrent) add('disposal', 'load', 'next', 'Review disposal before more pickups', 'Recorded load is near capacity. Check the next pickup requirements and verified disposal options with dispatch.', [evidence('loads', load.label, fleet, load.at)], 'Dispatcher');
  if (openJobs.length && scheduleCurrent) {
    if (stop || openRepairs.some(r => r.severity === 'out_of_service')) add('assigned-restriction', 'route', 'urgent', 'Review work assigned to a restricted truck', 'Dispatch must review these assignments against the recorded inspection or repair restriction. No job has been moved.', [evidence('schedule', openJobs.map(j => j.number).join(', '))], 'Dispatcher', agentScheduleHref(date));
    const missingCrew = openJobs.filter(j => !j.crew || /unassigned|unavailable/i.test(j.crew));
    if (missingCrew.length) add('crew', 'route', 'next', 'Verify crew assignment', 'Confirm the source crew assignment for the route; telemetry attribution is not a crew assignment.', [evidence('schedule', missingCrew.map(j => j.number).join(', '))], 'Dispatcher', agentScheduleHref(date));
    if (today && (!input.gps.available || !agentFresh(gps?.at || null, now))) add('gps', 'route', 'next', 'Current route position unavailable', 'Use the last GPS observation as history. Do not publish a current on-site claim or precise ETA from it.', [evidence('gps', 'No position within three minutes', fleet, gps?.at || null)], 'Dispatcher');
    for (const job of openJobs) if (today && job.end !== null && minuteOfDay(now) > job.end) add('window', job.id, 'next', `Check progress: ${job.number}`, 'The scheduled window has ended while the source appointment remains open. Check actual progress or closeout; this alone does not prove a missed visit.', [evidence('schedule', `${job.number} · ${job.time} · ${job.status}`, agentScheduleHref(date, job.id))], 'Dispatcher', agentScheduleHref(date, job.id));
  }
  for (const job of jobs.filter(j => complete(j.status))) {
    if (job.chargesPending) add('closeout', job.id, 'next', `Verify closeout detail: ${job.number}`, 'Completion is recorded but charge detail is still pending. Review the saved result rather than resubmitting.', [evidence('schedule', `${job.number} · charge detail pending`, agentScheduleHref(date, job.id))], 'Dispatcher', agentScheduleHref(date, job.id));
    if (job.photosMissing) add('photos', job.id, 'watch', `Review job photos: ${job.number}`, 'The available photo audit has no uploaded photos. Review whether supporting photos are still required.', [evidence('schedule', `${job.number} · no photos in available audit`, agentScheduleHref(date, job.id))], 'Crew / dispatcher', agentScheduleHref(date, job.id));
  }
  for (const cost of forTruck(input.costs.data)) add('receipt', cost.id, 'next', 'Review disposal receipt evidence', cost.note, [evidence('costs', cost.note, fleet, cost.at)], 'Dispatcher');
  if (today && minuteOfDay(now) >= 17 * 60 && openJobs.length && scheduleCurrent) add('shift-close', 'route', 'next', 'Reconcile open work before shift close', 'Review remaining appointments, closeouts, load and repair notes before preparing the next shift.', [evidence('schedule', `${openJobs.length} source appointments remain open`)], 'Dispatcher', agentScheduleHref(date));
  if (!recs.some(r => r.priority !== 'watch')) add('route-review', 'truck', 'watch', openJobs.length ? 'Review the next assigned stop' : 'Maintain readiness for the next assignment', openJobs.length ? 'Check current route evidence and required pickup capacity with dispatch.' : 'No open physical assignment appears in the available schedule. This does not prove the truck is idle or available.', [evidence('schedule', openJobs.map(j => `${j.number} · ${j.time}`).join('; ') || 'No open assignment in the retained schedule')], 'Dispatcher', agentScheduleHref(date));
  const order = ['assigned-restriction', 'inspection-stop', 'repair', 'identity', 'inspection-defect', 'fuel', 'inspection-missing', 'window', 'crew', 'gps', 'capacity'];
  recs.sort((a, b) => priorities[a.priority] - priorities[b.priority] || (order.indexOf(a.rule) < 0 ? 99 : order.indexOf(a.rule)) - (order.indexOf(b.rule) < 0 ? 99 : order.indexOf(b.rule)) || a.id.localeCompare(b.id));
  const activeIds = new Set(recs.map(r => `${r.id}:${r.version}`));
  const history = [...(prior?.history || []), ...(prior?.recommendations || []).filter(r => !activeIds.has(`${r.id}:${r.version}`)).map(r => ({ id: r.id, title: r.title, version: r.version, at: stamp, outcome: 'superseded' as const }))].slice(-100);
  return { id: `truck-${n}`, truck, mode: !mapped ? 'Identity review' : stop || openRepairs.some(r => r.severity === 'out_of_service') ? 'Repair recovery' : today && minuteOfDay(now) >= 17 * 60 ? 'Shift reconciliation' : openJobs.length ? 'Assigned route' : 'Readiness review', status: Object.values(input).every(s => s.available) && scheduleCurrent ? 'ok' : 'degraded', heartbeatAt: stamp, lastSuccessAt: stamp,
    summary: { assigned: input.schedule.available ? jobs.length : null, completed: input.schedule.available ? jobs.filter(j => complete(j.status)).length : null, nextJob: scheduleCurrent ? openJobs[0]?.number || null : null, load: load ? `${load.label}${!loadUsable ? ' · needs confirmation' : ''}` : 'Unknown', gpsAt: gps?.at || null, inspectionAt: inspection?.at || null },
    sources: Object.entries(input).map(([name, s]) => ({ name, observedAt: name === 'gps' ? gps?.at || null : name === 'inspections' ? inspection?.at || null : name === 'loads' ? load?.at || null : s.observedAt, available: s.available, note: s.note })), recommendations: recs, history };
}
