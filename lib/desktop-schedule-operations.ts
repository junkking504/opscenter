import { parseClassificationChange } from './appointment-classification';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import type { DesktopAppointment } from '@/lib/desktop-schedule';
import { withScheduleOperationLock, readJobRouteAssignmentOverrides, saveJobRouteAssignment } from '@/lib/job-route-assignments';
import type { SavedJunkwareAssignment } from '@/lib/junkware-truck-assignment';
import { closeoutSourceVersion } from '@/lib/desktop-closeout-contract';

export type ScheduleOperation = { requestId: string; date: string; recordId: string; expectedVersion: string; action: 'move' | 'call_ahead' | 'cancel' | 'note' | 'closeout' | 'classify'; values: Record<string, unknown> };
export type ScheduleReceipt = { requestId: string; actor: string; action: ScheduleOperation['action']; recordId: string; date: string; fingerprint: string; expectedCloseoutSourceVersion?: string; status: 'pending' | 'verified' | 'failed' | 'uncertain'; updatedAt: string; message: string; sourceResult?: Record<string, unknown>; priorResult?: { status: string; message: string; updatedAt: string } };
const directory = () => process.env.OPSCENTER_DESKTOP_OPERATIONS_DIR || path.join(process.cwd(), 'data', 'desktop-operations');
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export function parseScheduleOperation(value: unknown): ScheduleOperation {
  const body = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  const date = String(body.date || '');
  const requestId = String(body.requestId || '');
  const recordId = String(body.recordId || '');
  const expectedVersion = String(body.expectedVersion || '');
  const action = String(body.action || '') as ScheduleOperation['action'];
  if (!uuid.test(requestId) || !/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(Date.parse(date)) || new Date(`${date}T12:00:00Z`).toISOString().slice(0, 10) !== date || !recordId.startsWith(`${date}:appointment:`) || recordId.length > 100 || !/^[a-f0-9]{64}$/.test(expectedVersion) || !['move', 'call_ahead', 'cancel', 'note', 'closeout', 'classify'].includes(action)) throw new Error('A valid appointment, source version, operating date, and request ID are required.');
  const values = body.values && typeof body.values === 'object' ? body.values as Record<string, unknown> : {};
  if (JSON.stringify(values).length > 10_000) throw new Error('The appointment change is too large.');
  if (!new RegExp(`^${date}:appointment:[0-9]{1,12}$`).test(recordId)) throw new Error('A valid source appointment ID is required.');
  if (action === 'call_ahead' && typeof values.called !== 'boolean') throw new Error('A call-ahead status is required.');
  if (action === 'note' && (typeof values.note !== 'string' || !values.note.trim() || values.note.length > 2000)) throw new Error('A note of 1 to 2000 characters is required.');
  if (action === 'cancel' && (typeof values.reason !== 'string' || !values.reason.trim() || values.reason.length > 500)) throw new Error('A cancellation reason of 1 to 500 characters is required.');
  if (['closeout','classify'].includes(action) && !/^[a-f0-9]{64}$/.test(String(values.expectedSourceVersion || ''))) throw new Error('A current JunkWare closeout source version is required.');
  if (action === 'move') {
    if (typeof values.truck !== 'string' || (values.truck && !/^Truck [1-9][0-9]?$/.test(values.truck))) throw new Error('A valid truck assignment is required.');
    if (values.appointmentStartMinutes !== undefined) {
      const start = values.appointmentStartMinutes;
      const duration = values.durationHours;
      if (typeof start !== 'number' || !Number.isInteger(start) || start < 0 || start % 60 !== 0 || typeof duration !== 'number' || !Number.isInteger(duration) || duration < 1 || duration > 12 || start + duration * 60 > 1440) throw new Error('An hourly appointment window within the operating day is required.');
    } else if (values.durationHours !== undefined) throw new Error('A start time is required to change the appointment duration.');
  }
  if (action === 'classify') parseClassificationChange(values);
  return { requestId, date, recordId, expectedVersion, action, values };
}
export async function readScheduleReceipt(id: string): Promise<ScheduleReceipt | null> {
  if (!uuid.test(id)) return null;
  try {
    const receipt: ScheduleReceipt = JSON.parse(await fs.readFile(path.join(directory(), `${id}.json`), 'utf8'));
    // A process restart can interrupt a source write before its final receipt.
    // Never imply that an abandoned request is still running or permit replay.
    if (receipt.status === 'pending' && (!Number.isFinite(Date.parse(receipt.updatedAt)) || Date.now() - Date.parse(receipt.updatedAt) > 10 * 60_000)) {
      return { ...receipt, status: 'uncertain', message: 'Verification did not finish. Review this appointment in JunkWare before another change; do not resubmit the change.' };
    }
    return receipt;
  }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null; throw error; }
}
export async function readPendingScheduleReceipt(recordId: string): Promise<ScheduleReceipt | null> {
  const appointmentId = recordId.split(':appointment:')[1];
  if (!appointmentId) return null;
  let names: string[];
  try { names = await fs.readdir(directory()); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null; throw error; }
  for (const name of names) {
    if (!name.endsWith('.json')) continue;
    const receipt = await readScheduleReceipt(name.slice(0, -5));
    if (receipt?.recordId.split(':appointment:')[1] === appointmentId && (receipt.status === 'pending' || receipt.status === 'uncertain')) return receipt;
  }
  return null;
}
async function writeReceipt(receipt: ScheduleReceipt) {
  await fs.mkdir(directory(), { recursive: true, mode: 0o700 });
  const target = path.join(directory(), `${receipt.requestId}.json`);
  const temporary = `${target}.${process.pid}.tmp`;
  await fs.writeFile(temporary, JSON.stringify(receipt), { mode: 0o600 });
  await fs.rename(temporary, target);
}
export async function executeScheduleOperation(operation: ScheduleOperation, actor: string, load: () => DesktopAppointment | undefined, run: (job: DesktopAppointment) => Promise<{ status: number; body: Record<string, unknown> }>): Promise<ScheduleReceipt> {
  return withScheduleOperationLock(`request-${operation.requestId}`, () => withScheduleOperationLock(`appointment-${operation.recordId.split(':appointment:')[1]}`, async () => {
    const fingerprint = createHash('sha256').update(JSON.stringify(operation)).digest('hex');
    const existing = await readScheduleReceipt(operation.requestId);
    if (existing) {
      if (existing.fingerprint !== fingerprint || existing.actor !== actor) throw new Error('This request ID already belongs to a different change.');
      return existing; // Never replay an uncertain source write.
    }
    // A new browser, request UUID, or operating date must not bypass an
    // unresolved write for the same source appointment.
    const pending = await readPendingScheduleReceipt(operation.recordId);
    if (pending) throw new Error(`This appointment has an unverified change (${pending.requestId}). Check its saved result and JunkWare before another change.`);
    const job = load();
    if (!job || job.version !== operation.expectedVersion) throw new Error('This appointment changed. Refresh and review the current source record.');
    if (/cancel/i.test(job.status) && operation.action !== 'note') throw new Error('Canceled appointments cannot be changed through dispatch controls.');
    if (/complete|closed/i.test(job.status) && !['note', 'closeout', 'classify'].includes(operation.action)) throw new Error('Closed appointments cannot be changed through dispatch controls.');
    if (operation.action === 'move' && job.junkwareSyncStatus && job.junkwareSyncStatus !== 'verified') throw new Error('This appointment has an unverified change to its assignment. Verify it in JunkWare before another move.');
    let receipt: ScheduleReceipt = { requestId: operation.requestId, actor, action: operation.action, date: operation.date, recordId: operation.recordId, fingerprint, status: 'pending', updatedAt: new Date().toISOString(), message: 'Source verification in progress. Do not submit another change.' };
    if (operation.action === 'closeout') receipt.expectedCloseoutSourceVersion = String(operation.values.expectedSourceVersion);
    await writeReceipt(receipt);
    try {
      const result = await run(job);
      const verified = result.status >= 200 && result.status < 300 && result.status !== 202 && result.body.ok !== false;
      receipt = { ...receipt, status: verified ? 'verified' : result.status === 202 || result.status >= 500 ? 'uncertain' : 'failed', updatedAt: new Date().toISOString(), message: verified ? operation.action === 'call_ahead' ? 'Call-ahead recorded in OpsCenter.' : 'JunkWare verified the appointment change.' : String(result.body.warning || result.body.error || 'The source result needs verification.'), sourceResult: result.body };
      if (verified && operation.action === 'classify' && typeof result.body.warning === 'string') receipt.message += ` ${result.body.warning}`;
    } catch {
      receipt = { ...receipt, status: 'uncertain', updatedAt: new Date().toISOString(), message: 'The result could not be confirmed. Verify the source before trying again.' };
    }
    await writeReceipt(receipt);
    return receipt;
  }));
}

/** Checking a saved result never replays the write. Only an identical, freshly
 * reopened source baseline proves that an interrupted closeout was not saved. */
export async function reconcileCloseoutReceipt(id: string, actor: string, readSource: (appointmentId: string) => Promise<Record<string, unknown>>): Promise<ScheduleReceipt | null> {
  const initial = await readScheduleReceipt(id);
  if (!initial || initial.actor !== actor) return null;
  if (initial.action !== 'closeout' || initial.status !== 'uncertain' || !initial.expectedCloseoutSourceVersion) return initial;
  return withScheduleOperationLock(`appointment-${initial.recordId.split(':appointment:')[1]}`, async () => {
    const receipt = await readScheduleReceipt(id);
    if (!receipt || receipt.status !== 'uncertain') return receipt;
    let source: Record<string, unknown>;
    try { source = await readSource(receipt.recordId.split(':appointment:')[1]); }
    catch { return receipt; } // Source unavailable is not proof of failure.
    if (closeoutSourceVersion(source) !== receipt.expectedCloseoutSourceVersion) return receipt;
    const reconciled: ScheduleReceipt = { ...receipt, priorResult: {status:receipt.status,message:receipt.message,updatedAt:receipt.updatedAt}, status:'failed', updatedAt:new Date().toISOString(), message:'JunkWare confirms this closeout was not saved. Reload the closeout, review it, and try again.' };
    await writeReceipt(reconciled);
    return reconciled;
  });
}

/** A fresh, exact source match can resolve an old move without replaying it.
 * Mismatches and missing evidence remain blocked; no booking/payment is written. */
export async function reconcileMoveReceipt(id: string, actor: string, readSource: (appointmentId: string) => Promise<SavedJunkwareAssignment>): Promise<ScheduleReceipt | null> {
  const initial = await readScheduleReceipt(id);
  if (!initial || initial.actor !== actor) return null;
  if (initial.action !== 'move' || initial.status !== 'uncertain') return initial;
  return withScheduleOperationLock(`appointment-${initial.recordId.split(':appointment:')[1]}`, async () => {
    const receipt = await readScheduleReceipt(id);
    if (!receipt || receipt.status !== 'uncertain') return receipt;
    const expected = receipt.sourceResult?.assignment as Record<string, unknown> | undefined;
    const appointmentId = receipt.recordId.split(':appointment:')[1];
    if (!expected || expected.appointmentId !== appointmentId || expected.date !== receipt.date || typeof expected.truck !== 'string') return receipt;
    let source: SavedJunkwareAssignment;
    try { source = await readSource(appointmentId); } catch { return receipt; }
    const matches = (row: {truck:unknown;appointmentStartMinutes?:unknown;appointmentEndMinutes?:unknown}) => row.truck === expected.truck && (expected.appointmentStartMinutes === undefined || row.appointmentStartMinutes === expected.appointmentStartMinutes) && (expected.appointmentEndMinutes === undefined || row.appointmentEndMinutes === expected.appointmentEndMinutes);
    if (source.appointmentId !== appointmentId || !Number.isFinite(Date.parse(source.verifiedAt))) return receipt;
    if (source.date !== receipt.date || !matches(source)) {
      const clock = (minutes:number) => `${Math.floor(minutes/60)%12||12}:${String(minutes%60).padStart(2,'0')} ${minutes>=720?'PM':'AM'}`;
      const checked: ScheduleReceipt = {...receipt,updatedAt:new Date().toISOString(),message:`Earlier assignment change is still unresolved. JunkWare currently shows ${source.date}, ${source.truck || 'Unassigned'}, ${clock(source.appointmentStartMinutes)}–${clock(source.appointmentEndMinutes)}. This does not match the requested move; no closeout or payment was submitted by this check.`,sourceResult:{...receipt.sourceResult,assignmentReadback:source}};
      await writeReceipt(checked);
      return checked;
    }
    const current = readJobRouteAssignmentOverrides(receipt.date).get(`appt:${appointmentId}`);
    if (!current || !matches(current)) return receipt;
    const assignment = saveJobRouteAssignment({...current,expectedUpdatedAt:current.updatedAt,junkwareSyncStatus:'verified',junkwareSyncError:'',junkwareVerifiedAt:source.verifiedAt});
    if (!assignment) return receipt;
    const reconciled: ScheduleReceipt = {...receipt,status:'verified',updatedAt:new Date().toISOString(),message:'JunkWare confirms the saved truck and appointment window. No move or closeout was resubmitted.',priorResult:{status:receipt.status,message:receipt.message,updatedAt:receipt.updatedAt},sourceResult:{...receipt.sourceResult,junkwareSynced:true,assignment}};
    await writeReceipt(reconciled);
    return reconciled;
  });
}
