import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { createJunkwareAppointment, normalizeJunkwareAppointmentCreationInput, JunkwareAppointmentCreationError, type JunkwareAppointmentCreationInput, type JunkwareAppointmentCreationResult } from './junkware-appointment-creation';

export type DesktopCreationReceipt = { requestId: string; actor: string; fingerprint: string; identity?: string; status: 'pending' | 'verified' | 'failed' | 'uncertain'; updatedAt: string; error?: string; code?: string; result?: JunkwareAppointmentCreationResult };
const directory = () => process.env.OPSCENTER_DESKTOP_CREATIONS_DIR || path.join(process.cwd(), 'data', 'desktop-creations');
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const RECENT_VERIFIED_MS = 24 * 60 * 60 * 1000;
export function desktopCreationIdentity(input: JunkwareAppointmentCreationInput): string {
  return createHash('sha256').update(JSON.stringify({ phone: input.phone, address: input.serviceAddress.toLowerCase().replace(/[^a-z0-9]/g, ''), zip: input.serviceZip.slice(0, 5), date: input.date, startTime: input.startTime })).digest('hex');
}
export async function readDesktopCreation(id: string, actor: string): Promise<DesktopCreationReceipt | null> {
  if (!uuid.test(id)) return null;
  try { const receipt = JSON.parse(await fs.readFile(path.join(directory(), `${id}.json`), 'utf8')) as DesktopCreationReceipt; return receipt.actor === actor ? receipt : null; }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null; throw error; }
}
/** Only serializes journal reservation. External creation runs after the durable identity reservation. */
async function reserve<T>(work: () => Promise<T>): Promise<T> {
  const lock = path.join(directory(), '.reservation-lock');
  const deadline = Date.now() + 10_000;
  for (;;) {
    try { await fs.mkdir(lock); await fs.writeFile(path.join(lock, 'owner'), String(process.pid)); break; }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      try {
        const pid = Number(await fs.readFile(path.join(lock, 'owner'), 'utf8'));
        if (Number.isInteger(pid) && pid > 0) {
          try { process.kill(pid, 0); } catch (failure) { if ((failure as NodeJS.ErrnoException).code === 'ESRCH') { await fs.rm(lock, { recursive: true, force: true }); continue; } }
        }
      } catch (failure) {
        if ((failure as NodeJS.ErrnoException).code === 'ENOENT') {
          try { if (Date.now() - (await fs.stat(lock)).mtimeMs > 30_000) { await fs.rm(lock, { recursive: true, force: true }); continue; } } catch { /* Owner released it. */ }
        } else throw failure;
      }
      if (Date.now() >= deadline) throw new Error('Another booking reservation is in progress. Check the saved result before retrying.');
      await delay(25);
    }
  }
  try { return await work(); } finally { await fs.rm(lock, { recursive: true, force: true }); }
}
async function writeReceipt(receipt: DesktopCreationReceipt) {
  const target = path.join(directory(), `${receipt.requestId}.json`), temporary = `${target}.${process.pid}.tmp`;
  await fs.writeFile(temporary, JSON.stringify(receipt), { mode: 0o600 }); await fs.rename(temporary, target);
}
export async function executeDesktopCreation(value: unknown, actor: string, create: (input: JunkwareAppointmentCreationInput) => Promise<{ result: JunkwareAppointmentCreationResult; replayed: boolean }> = createJunkwareAppointment): Promise<DesktopCreationReceipt> {
  const input = normalizeJunkwareAppointmentCreationInput(value);
  const fingerprint = createHash('sha256').update(JSON.stringify(input)).digest('hex'), identity = desktopCreationIdentity(input);
  await fs.mkdir(directory(), { recursive: true, mode: 0o700 });
  const reservation = await reserve(async () => {
    const previous = await readDesktopCreation(input.requestId, actor);
    if (previous) { if (previous.fingerprint !== fingerprint) throw new Error('This request ID belongs to a different booking.'); return { receipt: previous, execute: false }; }
    try { await fs.access(path.join(directory(), `${input.requestId}.json`)); throw new Error('This request ID belongs to a different booking.'); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    let receipt: DesktopCreationReceipt = { requestId: input.requestId, actor, fingerprint, identity, status: 'pending', updatedAt: new Date().toISOString() };
    for (const file of (await fs.readdir(directory())).filter(name => uuid.test(name.slice(0, -5)) && name.endsWith('.json'))) {
      const other = JSON.parse(await fs.readFile(path.join(directory(), file), 'utf8')) as DesktopCreationReceipt;
      // Older unresolved receipts lack identity. They require explicit source recovery rather than unsafe replay.
      const unresolved = other.status === 'pending' || other.status === 'uncertain';
      if (other.identity !== identity && !(unresolved && !other.identity)) continue;
      if (unresolved) receipt = { ...receipt, status: 'failed', code: 'existing_unverified_booking', error: `A booking for these details has an unverified source result (${other.requestId}). Inspect that result and JunkWare before creating another appointment.` };
      else if (other.status === 'verified' && Date.now() - Date.parse(other.updatedAt) < RECENT_VERIFIED_MS && input.duplicateOverrideReason.trim().length < 10) receipt = { ...receipt, status: 'failed', code: 'duplicate_appointment', error: 'A recent verified booking already exists for this phone, address, date and start time. Open it, or record a deliberate duplicate-booking reason.' };
      if (receipt.status === 'failed') break;
    }
    await writeReceipt(receipt); return { receipt, execute: receipt.status === 'pending' };
  });
  if (!reservation.execute) return reservation.receipt;
  let receipt = reservation.receipt;
  try { receipt = { ...receipt, status: 'verified', result: (await create(input)).result }; }
  catch (error) {
    const known = error instanceof JunkwareAppointmentCreationError;
    const uncertain = !known || error.stage === 'saving' || error.stage === 'verifying';
    receipt = { ...receipt, status: uncertain ? 'uncertain' : 'failed', error: known ? error.message : 'The source result could not be confirmed. Check JunkWare before creating another appointment.', code: known ? error.code : 'verification_required' };
  }
  receipt.updatedAt = new Date().toISOString(); await writeReceipt(receipt); return receipt;
}
