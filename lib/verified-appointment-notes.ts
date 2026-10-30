import fs from 'node:fs';
import path from 'node:path';

type NoteJob = { appointmentId: string; appointmentNotes: string[]; appointmentNotesObservedAt?: string };
type NoteReceipt = { appointmentId: string; note: string; verifiedAt: string };
const maxAge = 24 * 60 * 60_000;
const record = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
const noteBody = (note: string) => note.replace(/\s*\(\d{1,2}\/\d{1,2}\/\d{4}\s+\d{1,2}:\d{2}(?::\d{2})?\s*(?:AM|PM)\s*,\s*[^()]+\)\s*$/i, '').replace(/^Note:\s*/i, '').replace(/\s+/g, ' ').trim();

/** Saved source read-back only. Never replays a note or writes collector data. */
export function verifiedAppointmentNote(value: unknown, now = Date.now()): NoteReceipt | null {
  const receipt = record(value), source = record(receipt.sourceResult), result = record(source.junkware);
  const appointmentId = String(result.appointmentId || ''), verifiedAt = String(result.verifiedAt || ''), at = Date.parse(verifiedAt);
  if (receipt.action !== 'note' || receipt.status !== 'verified' || source.ok !== true
    || !/^\d{1,12}$/.test(appointmentId) || !/^\d{4}-\d{2}-\d{2}:appointment:\d{1,12}$/.test(String(receipt.recordId))
    || String(receipt.recordId).split(':appointment:')[1] !== appointmentId
    || typeof result.note !== 'string' || !result.note.trim() || result.note.length > 500
    || !Number.isFinite(at) || at > now || now - at > maxAge) return null;
  return { appointmentId, note: result.note, verifiedAt };
}

export function applyVerifiedAppointmentNotes<T extends NoteJob>(jobs: T[], receipts: unknown[], now = Date.now()): T[] {
  const notes = receipts.map(receipt => verifiedAppointmentNote(receipt, now)).filter((note): note is NoteReceipt => Boolean(note)).sort((a,b) => Date.parse(a.verifiedAt)-Date.parse(b.verifiedAt));
  return jobs.map(job => {
    const observed = Date.parse(job.appointmentNotesObservedAt || '');
    const additions: string[] = [], seen = new Set(job.appointmentNotes.map(noteBody));
    for (const note of notes) {
      if (note.appointmentId !== job.appointmentId || observed >= Date.parse(note.verifiedAt) || seen.has(noteBody(note.note))) continue;
      seen.add(noteBody(note.note));
      const verified = new Date(note.verifiedAt).toLocaleString('en-US', {timeZone:'America/Chicago'}).replace(',', '');
      additions.push(`${note.note} (${verified} , Verified in JunkWare)`);
    }
    return additions.length ? {...job, appointmentNotes:[...job.appointmentNotes, ...additions]} : job;
  });
}

export function readVerifiedAppointmentNoteReceipts(now = Date.now()): unknown[] {
  const directory = process.env.OPSCENTER_DESKTOP_OPERATIONS_DIR || path.join(process.cwd(), 'data', 'desktop-operations');
  let names: string[];
  try { names = fs.readdirSync(directory); } catch { return []; }
  const receipts: unknown[] = [];
  for (const name of names) {
    if (!/^[0-9a-f-]{36}\.json$/i.test(name)) continue;
    try {
      const file = path.join(directory, name), stat = fs.statSync(file);
      if (stat.size > 128 * 1024 || now - stat.mtimeMs > maxAge) continue;
      const receipt: unknown = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (verifiedAppointmentNote(receipt, now)) receipts.push(receipt);
    } catch { /* An incomplete unrelated receipt must not hide collected notes. */ }
  }
  return receipts;
}
