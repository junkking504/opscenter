import { planningLocation } from './planning-geocodes';
import fs from 'node:fs';
import path from 'node:path';
import { readJobRows, junkwareScheduleUpdatedAt } from './desktop-schedule-source';
import { readVerifiedJunkwareScheduleSnapshot, readVerifiedJunkwareReconciliationSnapshot } from './junkware-fast-schedule';
import { buildFleetMapPayload } from './fleet-map';
import { listTruckInspections, truckInspectionDates } from './truck-inspection-store';
import { inspectionReportHref } from './truck-inspection-fleet';
import { readOperationalTruckLoads } from './truck-load-closeouts';
import type { TruckInspectionReport } from './truck-inspection';
import { agentTruckNumber } from '../desktop-ui/lib/truck-agent-contract';
import type { OperationalAgentState } from './operational-agents';
import type { TruckAgentInputs, AgentSource } from './truck-agent-rules';

export const truckAgentRoot = () => process.env.OPSCENTER_DATA_DIR || process.env.OPSBOT_DATA_DIR || path.join(process.cwd(), 'data');
type Row = Record<string, unknown>;
const string = (v: unknown) => String(v || '');
const observed = (v: unknown) => { const text = string(v); if (!Number.isFinite(Date.parse(text))) throw new Error('Source watermark unavailable'); return text; };
function json(relative: string): Row { const value = JSON.parse(fs.readFileSync(path.join(truckAgentRoot(), relative), 'utf8')); if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid source'); return value; }
function rows(value: unknown): Row[] { if (!Array.isArray(value) || value.some(r => !r || typeof r !== 'object')) throw new Error('Invalid source rows'); return value; }
function source<T>(read: () => { data: T; at: string | null }): AgentSource<T> {
  try { const { data, at } = read(); return { data, observedAt: at, available: true, note: '' }; }
  catch { return { data: [] as T, observedAt: null, available: false, note: 'The source could not be read or validated. Retained evidence is not current verification.' }; }
}
const latest = (values: Array<string | null>) => values.filter((v): v is string => Boolean(v) && Number.isFinite(Date.parse(v!))).sort().at(-1) || null;

const stopCache = new Map<string, { mtime: number; report: TruckInspectionReport | null }>();
function stopReports(base: string, day: string): TruckInspectionReport[] {
  const directory = path.join(base, 'dates', day);
  return fs.readdirSync(directory).filter(f => /^[a-f0-9]{64}\.json$/.test(f)).flatMap(file => {
    const full = path.join(directory, file), mtime = fs.statSync(full).mtimeMs, cached = stopCache.get(full);
    if (cached?.mtime === mtime) return cached.report ? [cached.report] : [];
    const value = JSON.parse(fs.readFileSync(full, 'utf8')) as TruckInspectionReport;
    if (value.inspectionDate !== day || !Array.isArray(value.answers) || !Number.isFinite(Date.parse(value.startedAt))) throw new Error('Invalid inspection history');
    const report = value.status === 'stop' ? { ...value, photos: [] } : null;
    if (stopCache.size > 10_000) stopCache.clear();
    stopCache.set(full, { mtime, report }); return report ? [report] : [];
  });
}

/** Reads collected local sources only. No refresh, provider or source mutation. */
export function readTruckAgentInputs(date: string, now = Date.now()): TruckAgentInputs {
  let jobs: ReturnType<typeof readJobRows> = [];
  const schedule: TruckAgentInputs['schedule'] = source(() => {
    const verified = readVerifiedJunkwareScheduleSnapshot(truckAgentRoot(), date);
    const canonical = readVerifiedJunkwareReconciliationSnapshot(truckAgentRoot(), date);
    if (!verified && !canonical) throw new Error('No verified schedule');
    jobs = readJobRows(date);
    const snapshot = verified && (!canonical || verified.updatedAtMs > canonical.updatedAtMs) ? verified : canonical!;
    // Use the oldest verified market observation, not the new worker heartbeat.
    const at = Number.isFinite(snapshot.freshnessAtMs) ? new Date(snapshot.freshnessAtMs).toISOString() : junkwareScheduleUpdatedAt(date);
    let pins: Record<string, Record<string, unknown>> = {};
    try { pins = json('cache/appointment_geocodes.json').addresses as typeof pins || {}; } catch { /* Unverified addresses have no location. */ }
    return { at, data: jobs.map(j => ({ location: planningLocation(j.address, pins), start: j.appointmentStartMinutes, id: j.appointmentId, number: j.jkNumber, truck: j.assignedTruck || j.truck,
      status: j.status, crew: [j.driver, j.navigator, ...(j.additionalCrew || [])].filter(v => v && !/^(unassigned|unavailable|—)$/i.test(v)).join(', '),
      end: j.appointmentEndMinutes, time: j.appointmentTime, photosMissing: j.photoAuditAvailable && !j.photos.length, chargesPending: Boolean(j.chargeDetailsPending) })) };
  });
  const identity: TruckAgentInputs['identity'] = source(() => {
    const data = json('config/linxup_vehicle_map.json');
    return { at: observed(data.last_validated_at), data: rows(data.mappings).filter(r => r.status === 'active' && string(r.effective_start_date) <= date && (!r.effective_end_date || string(r.effective_end_date) >= date)).map(r => ({ truck: string(r.junkware_truck_number), tracker: string(r.linxup_tracker_id) })).filter(r => r.tracker) };
  });
  const repairs: TruckAgentInputs['repairs'] = source(() => {
    const data = json('fleet/repair_issues.json');
    return { at: observed(data.updatedAt), data: rows(data.issues).filter(r => !r.deletedAt).map(r => ({ id: string(r.issueId), truck: string(r.truck), title: string(r.title), status: string(r.status), severity: string(r.severity), owner: string(r.owner), due: string(r.dueDate), at: string(r.updatedAt) })) };
  });
  const maintenance: TruckAgentInputs['maintenance'] = source(() => {
    const data = json('fleet/maintenance_records.json');
    return { at: observed(data.updatedAt), data: rows(data.records).map(r => ({ truck: string(r.truck), id: string(r.recordId), status: string(r.status), date: string(r.serviceDate), type: string(r.serviceType), vendor: string(r.vendor), at: string(r.updatedAt) })) };
  });
  const inspections: TruckAgentInputs['inspections'] = source(() => {
    const base = process.env.OPS_TRUCK_INSPECTION_DIR || path.join(truckAgentRoot(), 'fleet', 'truck-inspections');
    fs.accessSync(base);
    const directory = path.join(base, 'dates', date);
    // The shared reader skips damaged reports. Validate the selected index first.
    if (fs.existsSync(directory)) for (const file of fs.readdirSync(directory).filter(f => /^[a-f0-9]{64}\.json$/.test(f))) {
      const report = JSON.parse(fs.readFileSync(path.join(directory, file), 'utf8'));
      if (report.inspectionDate !== date || !Array.isArray(report.answers) || !Number.isFinite(Date.parse(report.startedAt))) throw new Error('Invalid inspection');
    }
    const reports = listTruckInspections(date);
    // A day boundary or later clear inspection cannot erase an unresolved stop.
    // Only an explicitly linked resolved repair supplies its disposition.
    const repairRows = rows(json('fleet/repair_issues.json').issues);
    for (const day of truckInspectionDates().filter(day => day < date)) reports.push(...stopReports(base, day));
    const disposed = new Set(reports.filter(report => report.status === 'stop').filter(report => {
      const reference = `${report.deviceId}:${report.requestId}`;
      return repairRows.some(r => !r.deletedAt && r.status === 'resolved' && agentTruckNumber(r.truck) === agentTruckNumber(report.truck)
        && (r.sourceChecklistEntryId === reference || string(r.resolution).includes(reference) || string(r.resolution).includes(encodeURIComponent(reference))));
    }).map(report => `${report.deviceId}:${report.requestId}`));
    return { at: latest(reports.map(r => r.receivedAt)), data: reports.map(r => ({ truck: r.truck, at: r.startedAt, href: inspectionReportHref(r), status: disposed.has(`${r.deviceId}:${r.requestId}`) ? 'stop_disposed' : r.status, fuel: r.fuel, odometer: r.odometer,
      findings: [...r.answers.filter(a => a.status === 'problem' || a.notes.trim()).map(a => `${a.id}: ${a.notes || 'Problem reported'}`), ...(r.notes ? [r.notes] : [])] })) };
  });
  const gps: TruckAgentInputs['gps'] = source(() => {
    const map = buildFleetMapPayload(date); if (!map) throw new Error('GPS unavailable');
    return { at: map.lastUpdatedAt || null, data: map.trucks.map(t => ({ truck: t.truck, at: t.hasCoordinates ? t.lastGpsUpdate : null, speed: t.speed, ignition: t.ignition, latitude: t.latitude, longitude: t.longitude,
      points: t.routePoints.filter(p => Date.parse(p.timestamp) >= now - 2 * 3600_000).map(p => ({ timestamp: p.timestamp, latitude: p.latitude, longitude: p.longitude, speed: p.speed, ignition: p.ignition, deliverySource: p.deliverySource, continuousUntil: p.continuousUntil })) })) };
  });
  const loads: TruckAgentInputs['loads'] = source(() => {
    const ledger = json('fleet/truck_load_status.json'); rows(ledger.events);
    const data = readOperationalTruckLoads(date, Array.from({ length: 9 }, (_, i) => `Truck ${i + 1}`), jobs);
    return { at: latest(data.map(r => r.lastEvent?.occurredAt || null)), data: data.map(r => ({ truck: r.truck, label: r.displayLoadLabel || r.currentLoadLabel, percent: r.needsVerification ? null : r.capacityPercent,
      at: r.lastEvent?.kind === 'day_start' && r.carriedFromDate ? null : r.lastEvent?.occurredAt || null, uncertain: Boolean(r.carriedFromDate && !r.events.some(e => e.kind !== 'day_start')) || Boolean(r.needsVerification) || !schedule.available || !inspections.available,
      note: r.verificationNote || (r.carriedFromDate ? `Baseline carried from ${r.carriedFromDate}` : r.currentContents) })) };
  });
  let operational: OperationalAgentState | null = null;
  try { operational = json(`fleet/agents/${date}.json`) as unknown as OperationalAgentState; } catch { /* Independently unavailable below. */ }
  const visits: TruckAgentInputs['visits'] = source(() => {
    const value = operational?.agents['visit-tracking']; if (!value?.result || value.status !== 'ok') throw new Error('Visit projection unavailable');
    return { at: latest(Object.values(value.watermarks).map(v => v > 0 ? new Date(v).toISOString() : null)), data: value.result.visits.filter(v => v.firstObservedAt?.startsWith(date) || v.departedAt?.startsWith(date)).map(v => ({ appointmentId: v.kind === 'appointment' ? v.appointmentId : undefined, conflict: v.conflict, superseded: Boolean(v.supersededAt), truck: v.truck, name: v.name, entered: v.enteredAt || v.firstObservedAt || '', departed: v.departedAt })) };
  });
  const costs: TruckAgentInputs['costs'] = source(() => {
    const value = operational?.agents['unload-cost']; if (!value?.result || value.status !== 'ok' || value.dependency === 'retained') throw new Error('Cost projection unavailable');
    return { at: latest(Object.values(value.watermarks).map(v => v > 0 ? new Date(v).toISOString() : null)), data: value.result.records.filter(r => r.date === date && (Boolean(r.reconciliationNote) || r.status === 'minimum_missing' || r.status === 'assumed' && r.departedAt && now - Date.parse(r.departedAt) > 3600_000)).map(r => ({ id: r.id, truck: r.truck, at: r.transactionAt, note: `${r.location}: ${r.reconciliationNote || (r.status === 'assumed' ? 'Expense remains assumed more than one hour after recorded departure. Match the actual receipt.' : 'Disposal expense requires source review.')}` })) };
  });
  return { identity, repairs, maintenance, inspections, schedule, gps, loads, visits, costs };
}
