import { estimateCharges, type EstimateCharges } from './estimate-charges';
import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { chicagoDateKey, addDays } from './report-dates';
import { readVerifiedJunkwareScheduleSnapshot } from './junkware-fast-schedule';
import { junkwareJobPhotos } from './junkware-job-details';
import { opsRoleCan, type InteractiveOpsRole } from './ops-roles';
import { estimateSummary, type EstimateBooking, type EstimateChange, type EstimateEvent, type EstimateFollowup, type EstimateRow, type EstimateSnapshot } from '../desktop-ui/lib/estimate-contract';

type Raw = Record<string, unknown>;
type Source = { id: string; jk: string; customer: string; phone: string; email: string; address: string; territory: string; date: string; type: string; status: string; estimateId: string; quote: number | null; notes: string[]; photos: EstimateRow['photos']; pricing: string; charges: EstimateCharges; observedAt: string | null; order: number };
type Store = { schema: 1; records: Record<string, EstimateEvent[]> };
const text = (value: unknown) => String(value ?? '').trim();
const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const isEstimate = (row: Source) => /estimate/i.test(row.type);
const canceled = (row: Source) => /cancel/i.test(row.status);
const completed = (row: Source) => /^(?:estimate\s+)?(?:completed|closed)\b/i.test(row.status);
const dataDirectory = () => process.env.OPSBOT_DATA_DIR || path.join(process.env.HOME || '', '.openclaw/workspace/opsbot/data');
const storeDirectory = () => path.join(dataDirectory(), 'estimate-follow-up');
const validId = (id: unknown): id is string => typeof id === 'string' && /^\d{1,12}$/.test(id);
export const validEstimateDate = (date: string) => /^\d{4}-\d{2}-\d{2}$/.test(date) && Number.isFinite(Date.parse(date)) && new Date(`${date}T12:00:00Z`).toISOString().slice(0, 10) === date;
const emptyFollowup = (): EstimateFollowup => ({ status: 'verify_booking', owner: '', nextFollowup: '', reason: '', lastContactAt: null });
export class EstimateError extends Error { constructor(message: string, readonly status = 409) { super(message); } }
function amount(value: unknown): number | null { const number = text(value).replace(/[$,]/g, ''); return /^\d+(?:\.\d{1,2})?$/.test(number) && Number.isFinite(Number(number)) ? Number(number) : null; }

function sourceRow(row: Raw, day: string, observed: string): Source | null {
  const id = text(row.appt_id || row.appointment_id);
  if (!validId(id)) return null;
  const charges = row.closeout && typeof row.closeout === 'object' ? row.closeout as Raw : {};
  const stamp = text(row.collection_timestamp) || observed;
  const at = Number.isFinite(Date.parse(stamp)) ? new Date(stamp).toISOString() : null;
  const date = text(row.appointment_date) || day;
  if (!validEstimateDate(date)) return null;
  const notes = Array.isArray(row.appointment_notes) ? row.appointment_notes.map(text).filter(Boolean) : [];
  for (const key of ['franchise_notes', 'customer_notes', 'additional_notes']) if (text(row[key]) && !notes.includes(text(row[key]))) notes.push(text(row[key]));
  return { id, jk: text(row.job_id || row.jk_number), customer: text(row.customer_name), phone: text(row.phone), email: text(row.customerEmail || row.customer_email), address: text(row.address), territory: text(row.normalized_territory || row.territory || row.market), date, type: text(row.final_appointment_type || row.appointment_type), status: text(row.final_status || row.job_status), estimateId: text(row.source_estimate_appointment_id), quote: amount(charges.total), charges: estimateCharges(charges), notes, photos: junkwareJobPhotos(row), pricing: [text(charges.loadSize) && `${text(charges.loadQuantity) || '1'} × ${text(charges.loadSize)}`, text(charges.bedloadSize) && !/^none$/i.test(text(charges.bedloadSize)) && `${text(charges.bedloadQuantity) || '1'} × ${text(charges.bedloadSize)}`, ...(Array.isArray(charges.otherCharges) ? charges.otherCharges.map(value => text((value as Raw).name)).filter(Boolean) : [])].filter(Boolean).join(' · '), observedAt: at, order: at ? Date.parse(at) : 0 };
}

// Cache projected rows per file. Routine local reads do not reparse all archives
// or initiate JunkWare requests. Fast source observations can supersede archives.
const fileCache = new Map<string, { signature: string; rows: Source[] }>();
function readSources(today: string) {
  const directory = path.join(dataDirectory(), 'history/junkware');
  const names = fs.readdirSync(directory).filter(name => /^junkware_\d{4}-\d{2}-\d{2}_raw\.json$/.test(name)).sort();
  if (!names.length) throw new EstimateError('Estimate history is unavailable.', 503);
  const latest = new Map<string, Source>(), estimates = new Map<string, Source>();
  let unreadable = 0;
  const accept = (row: Source) => {
    if (!latest.has(row.id) || row.order >= latest.get(row.id)!.order) latest.set(row.id, row);
    if (isEstimate(row) && completed(row) && !canceled(row) && row.date <= today && (!estimates.has(row.id) || row.order >= estimates.get(row.id)!.order)) estimates.set(row.id, row);
  };
  for (const name of names) {
    const file = path.join(directory, name);
    try {
      const stat = fs.statSync(file), signature = `${stat.mtimeMs}:${stat.size}`;
      let cached = fileCache.get(file);
      if (cached?.signature !== signature) {
        const payload = JSON.parse(fs.readFileSync(file, 'utf8'));
        const buckets = ['appointments', 'completed', 'cancelled'];
        // Older archives omit empty buckets. Retain their available records;
        // malformed present buckets still fail instead of implying emptiness.
        if (!buckets.some(key => Array.isArray(payload[key])) || buckets.some(key => payload[key] !== undefined && !Array.isArray(payload[key]))) throw new Error('Invalid archive');
        const rows = buckets.flatMap(key => (payload[key] || []) as Raw[]).flatMap(row => sourceRow(row, name.slice(9, 19), text(payload.scraped_at)) || []);
        cached = { signature, rows }; fileCache.set(file, cached);
      }
      cached.rows.forEach(accept);
    } catch { unreadable += 1; }
  }
  for (const day of [today, addDays(today, 1)]) {
    const fast = readVerifiedJunkwareScheduleSnapshot(dataDirectory(), day);
    if (!fast) continue;
    for (const raw of [...fast.appointments, ...fast.cancelled]) {
      const row = sourceRow({ ...raw, collection_timestamp: fast.updatedAt }, day, fast.updatedAt);
      if (!row) continue;
      const old = latest.get(row.id);
      // The detector's rows omit quote/notes. Preserve those details while
      // replacing only current appointment facts, never stale type/status.
      accept(old ? { ...old, id: row.id, type: row.type || old.type, status: row.status || old.status, date: row.date, estimateId: row.estimateId || old.estimateId, observedAt: row.observedAt, order: row.order } : row);
    }
  }
  if (unreadable === names.length) throw new EstimateError('All estimate history files are unavailable.', 503);
  return { latest, estimates, coverage: { files: names.length, unreadable, latestObservation: [...latest.values()].map(row => row.observedAt || '').sort().at(-1) || null } };
}

function readStore(): Store {
  try {
    const store = JSON.parse(fs.readFileSync(path.join(storeDirectory(), 'state.json'), 'utf8')) as Store;
    if (store.schema !== 1 || !store.records || Array.isArray(store.records) || typeof store.records !== 'object') throw new Error('Invalid follow-up store');
    for (const [id, events] of Object.entries(store.records)) {
      if (!validId(id) || !Array.isArray(events) || events.some(event => !event.requestId || !event.actor || !event.at || !event.before || !event.after || !['verify_booking','needs_follow_up','waiting','lost'].includes(event.after.status) || typeof event.after.owner !== 'string' || typeof event.after.nextFollowup !== 'string' || typeof event.after.reason !== 'string')) throw new Error('Invalid follow-up history');
    }
    return store;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { schema: 1, records: {} };
    throw new EstimateError('Saved follow-up history is unavailable. Changes are blocked until it is recovered.', 503);
  }
}

export function readEstimateFollowups(today = chicagoDateKey()): EstimateSnapshot {
  const { latest, estimates, coverage } = readSources(today), store = readStore();
  const jobs = [...latest.values()].filter(row => /^job$/i.test(row.type));
  const byEstimate = new Map<string, Source[]>();
  for (const job of jobs) if (job.estimateId) byEstimate.set(job.estimateId, [...(byEstimate.get(job.estimateId) || []), job]);
  const booking = (row: Source): EstimateBooking => ({ id: row.id, jk: row.jk, date: row.date, status: row.status, observedAt: row.observedAt });
  const phone = (value: string) => value.replace(/\D/g, '').slice(-10);
  const norm = (value: string) => value.toLowerCase().replace(/[^a-z0-9]/g, '');
  const possibleIndex = new Map<string, Source[]>();
  const keys = (row: Source) => [row.jk && `jk:${row.jk}`, phone(row.phone).length === 10 && `phone:${phone(row.phone)}`, norm(row.address).length > 10 && `address:${norm(row.address)}`].filter(Boolean) as string[];
  for (const job of jobs.filter(row => !canceled(row))) for (const key of keys(job)) possibleIndex.set(key,[...(possibleIndex.get(key) || []),job]);
  const recent = new Date(`${today.slice(0,7)}-01T12:00:00Z`); recent.setUTCMonth(recent.getUTCMonth() - 1);
  const rows: EstimateRow[] = [];
  for (const [id, estimate] of estimates) {
    const current = latest.get(id)!;
    if (isEstimate(current) && (canceled(current) || !completed(current))) continue;
    const history = store.records[id] || [], followup = history.at(-1)?.after || emptyFollowup();
    const related = [...(byEstimate.get(id) || []), ...(/^job$/i.test(current.type) ? [current] : [])];
    const unique = [...new Map(related.map(row => [row.id,row])).values()];
    const bookings = unique.filter(row => !canceled(row)).map(booking);
    const possibleBookings = bookings.length ? [] : [...new Map(keys(estimate).flatMap(key => possibleIndex.get(key) || []).map(job => [job.id,job])).values()].filter(job => job.date >= estimate.date && !unique.some(row => row.id === job.id)).map(booking);
    const status = bookings.length ? 'converted' : followup.status;
    const source = isEstimate(current) ? current : estimate;
    // Observation timestamps do not invalidate a user's draft on each sweep.
    const version = hash({ source: { id, date: source.date, type: current.type, status: current.status, quote: source.quote, charges: source.charges, notes: source.notes, bookings: unique.map(row => [row.id,row.type,row.status,row.date]) }, history });
    rows.push({ id, jk: source.jk, customer: source.customer, phone: source.phone, email: source.email, address: source.address, territory: source.territory, date: source.date, quote: source.quote, observedAt: source.observedAt, sourceStatus: source.status, notes: source.notes, photos: source.photos, pricing: source.pricing, charges: source.charges, status, followup, history, tracked: history.length > 0, bookings, canceledBookings: unique.filter(canceled).map(booking), possibleBookings, version, ageDays: Math.max(0, Math.round((Date.parse(today)-Date.parse(source.date))/86400000)), overdue: status !== 'converted' && status !== 'lost' && Boolean(followup.nextFollowup) && followup.nextFollowup < today, dueToday: status !== 'converted' && status !== 'lost' && followup.nextFollowup === today });
  }
  rows.sort((a,b) => Number(b.overdue)-Number(a.overdue) || Number(b.dueToday)-Number(a.dueToday) || b.date.localeCompare(a.date) || a.id.localeCompare(b.id));
  return { today, generatedAt: new Date().toISOString(), recentStart: recent.toISOString().slice(0,10), rows, coverage, canWrite: false, actor: '' };
}
export function readEstimateSummary() {
  try { return estimateSummary(readEstimateFollowups()); }
  catch { return { available: false, recentStart: '', review: 0, unassigned: 0, overdue: 0, dueToday: 0 }; }
}

export function parseEstimateChange(body: unknown): EstimateChange {
  if (!body || typeof body !== 'object') throw new EstimateError('A follow-up change is required.', 400);
  const value = body as EstimateChange;
  if (!validId(value.id) || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value.requestId) || !/^[a-f0-9]{64}$/.test(value.expectedVersion) || !['needs_follow_up','verify_booking','waiting','lost'].includes(value.status) || typeof value.contacted !== 'boolean') throw new EstimateError('A valid estimate, version and action are required.', 400);
  for (const key of ['owner','nextFollowup','reason','note'] as const) if (typeof value[key] !== 'string' || value[key].length > (key === 'note' ? 2000 : key === 'reason' ? 500 : 120)) throw new EstimateError('Follow-up fields are invalid or too long.', 400);
  const change = { requestId: value.requestId, id: value.id, expectedVersion: value.expectedVersion, status: value.status, owner: value.owner.trim(), nextFollowup: value.nextFollowup.trim(), reason: value.reason.trim(), note: value.note.trim(), contacted: value.contacted };
  if (change.nextFollowup && !validEstimateDate(change.nextFollowup)) throw new EstimateError('Choose a valid follow-up date.', 400);
  if (['needs_follow_up','waiting'].includes(change.status) && (!change.owner || !change.nextFollowup)) throw new EstimateError('Assign one owner and a next follow-up date.', 400);
  if (!change.reason) throw new EstimateError('Record the reason or next action.', 400);
  if (change.contacted && !change.note) throw new EstimateError('Describe the contact and its outcome.', 400);
  if (change.status === 'lost') change.nextFollowup = '';
  return change;
}

export function saveEstimateFollowup(input: unknown, actor: { email: string; role: InteractiveOpsRole }, today = chicagoDateKey()) {
  if (!opsRoleCan(actor.role, 'operations.write')) throw new EstimateError('This role cannot update follow-ups.', 403);
  const change = parseEstimateChange(input), directory = storeDirectory();
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  const lock = path.join(directory, '.write-lock');
  try { fs.mkdirSync(lock, { mode: 0o700 }); } catch { throw new EstimateError('Another follow-up save is running or requires recovery. Refresh before continuing.'); }
  try {
    const store = readStore(), fingerprint = hash(change);
    for (const [id, history] of Object.entries(store.records)) {
      const existing = history.find(event => event.requestId === change.requestId);
      if (!existing) continue;
      if (id !== change.id || existing.actor !== actor.email || existing.fingerprint !== fingerprint) throw new EstimateError('Request ID belongs to another change.');
      return existing;
    }
    const row = readEstimateFollowups(today).rows.find(row => row.id === change.id);
    if (!row || row.version !== change.expectedVersion) throw new EstimateError('The estimate changed. Reload and review before saving.');
    if (row.status === 'converted') throw new EstimateError('This estimate has a linked job. Review the booking instead.');
    const at = new Date().toISOString();
    const event: EstimateEvent = { requestId: change.requestId, fingerprint, actor: actor.email, at, note: change.note, contacted: change.contacted, before: row.followup, after: { status: change.status, owner: change.owner, nextFollowup: change.nextFollowup, reason: change.reason, lastContactAt: change.contacted ? at : row.followup.lastContactAt } };
    store.records[change.id] = [...(store.records[change.id] || []), event];
    const file = path.join(directory, 'state.json'), temp = path.join(directory, `${randomUUID()}.tmp`);
    try {
      const fd = fs.openSync(temp, 'wx', 0o600);
      try { fs.writeFileSync(fd, JSON.stringify(store)); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
      fs.renameSync(temp, file);
    } finally { if (fs.existsSync(temp)) fs.unlinkSync(temp); }
    const saved = readStore().records[change.id]?.at(-1);
    if (saved?.requestId !== change.requestId || saved.fingerprint !== fingerprint) throw new EstimateError('Save could not be verified. Reload and inspect history before retrying.', 503);
    return saved;
  } finally { fs.rmdirSync(lock); }
}
