import fs from 'node:fs/promises';
import path from 'node:path';
import { readVerifiedJunkwareScheduleSnapshot } from './junkware-fast-schedule';
import { chicagoDateKey, addDays } from './report-dates';
import type { CustomerHistory, CustomerHistoryRecord } from '../desktop-ui/lib/customer-history-contract';

type Raw = Record<string, unknown>;
type Source = Omit<CustomerHistoryRecord, 'relationship'> & { phone: string; email: string; estimateId: string; order: number };
const text = (value: unknown) => typeof value === 'string' || typeof value === 'number' ? String(value).trim() : '';
const idValid = (value: string) => /^\d{1,12}$/.test(value);
export const historyDateValid = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(`${value}T12:00:00Z`).toISOString().slice(0, 10) === value;
const normalized = (value: string) => value.toLowerCase().replace(/[^a-z0-9]/g, '');
const phoneKey = (value: string) => { const digits = value.replace(/\D/g, '').replace(/^1(?=\d{10}$)/, ''); return /^\d{10}$/.test(digits) && !/^(\d)\1+$/.test(digits) ? digits : ''; };
const emailKey = (value: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) ? value.toLowerCase() : '';
const amount = (value: unknown) => { const raw = text(value).replace(/[$,]/g, ''); return /^-?\d+(?:\.\d{1,2})?$/.test(raw) && Number.isFinite(Number(raw)) ? Number(raw) : null; };
const amountMissing = (value: unknown) => value === undefined || value === null || (typeof value === 'string' && value.trim() === '');
const money = (value: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(value);

function recordedAmounts(closeout: Raw, estimate: boolean, pending: boolean): string[] {
  if (pending) return ['Payment updating'];
  const total = amount(closeout.total), tip = amount(closeout.tip), balance = amount(closeout.balance);
  if (estimate) return total !== null && total >= 0 ? [`Quote ${money(total)}`] : [];
  const amounts: string[] = [];
  const rows = Array.isArray(closeout.payments) ? closeout.payments : [];
  const payments = rows.map(payment => ({ amount: payment && typeof payment === 'object' ? amount(payment.amount) : null, method: text(payment?.method) }));
  const billed = (method: string) => /\bbill(?:ed|ing)?\b|invoice|accounts? receivable/i.test(method);
  const received = payments.filter(row => !billed(row.method)).reduce((sum, row) => sum + (row.amount || 0), 0);
  // Older closeouts leave optional amount fields blank. Missing is unknown,
  // not a contradiction; retain the other recorded amounts without inventing zero.
  const invalid = ['total', 'tip', 'balance'].some(key => !amountMissing(closeout[key]) && amount(closeout[key]) === null)
    || (closeout.payments !== undefined && !Array.isArray(closeout.payments)) || payments.some(row => row.amount === null)
    || (total !== null && total < 0) || (tip !== null && (tip < 0 || (total !== null && tip > total)))
    || (tip !== null && received > 0 && tip > received);
  // Keep signed adjustments visible. Do not silently turn a refund, unknown
  // amount, or inconsistent tip into an apparently fully collected payment.
  if (invalid) return ['Recorded amounts conflict · payment details unavailable'];
  const tipSuffix = tip !== null && tip > 0 ? ' · including tips' : '';
  if (total !== null) amounts.push(`Charges ${money(total)}${tipSuffix}`);
  for (const payment of payments) {
    if (payment.amount === null || payment.amount === 0) continue;
    const label = payment.amount < 0 ? 'Recorded adjustment' : billed(payment.method) ? 'Billed' : 'Recorded payment';
    amounts.push(`${label} ${money(payment.amount)}${payment.method ? ` · ${payment.method}` : ''}${tipSuffix}`);
  }
  if (tip !== null && tip > 0) amounts.push(`Tip ${money(tip)} included above`);
  if (balance !== null && balance !== 0) amounts.push(`Recorded ${balance < 0 ? 'credit' : 'balance'} ${money(Math.abs(balance))}`);
  return amounts;
}

export function historySource(row: Raw, day: string, observation: string): Source | null {
  const id = text(row.appt_id || row.appointment_id), date = text(row.appointment_date) || day;
  if (!idValid(id) || !historyDateValid(date)) return null;
  const type = text(row.final_appointment_type || row.appointment_type), stamp = text(row.collection_timestamp) || observation;
  const observedAt = Number.isFinite(Date.parse(stamp)) ? new Date(stamp).toISOString() : null;
  const closeout = row.closeout && typeof row.closeout === 'object' ? row.closeout as Raw : {};
  const amounts = recordedAmounts(closeout, /estimate/i.test(type), row.closeout_refresh_pending === true || row.closeout_refresh_pending === 'true');
  const notes = [...(Array.isArray(row.appointment_notes) ? row.appointment_notes.map(text) : []), ...['franchise_notes', 'customer_notes', 'additional_notes'].map(key => text(row[key]))].filter(Boolean);
  return { id, jk: text(row.job_id || row.jk_number), date, customer: text(row.customer_name), address: text(row.address), type, status: text(row.final_status || row.job_status), phone: phoneKey(text(row.phone)), email: emailKey(text(row.customerEmail || row.customer_email)), estimateId: text(row.source_estimate_appointment_id), amounts, notes: [...new Set(notes)].slice(-2).map(note => note.slice(0, 1000)), observedAt, order: observedAt ? Date.parse(observedAt) : 0 };
}

export function relatedHistory(sources: Source[], appointmentId: string): CustomerHistoryRecord[] | null {
  const latest = new Map<string, Source>();
  for (const row of sources) if (!latest.has(row.id) || row.order >= latest.get(row.id)!.order) latest.set(row.id, row);
  const anchor = latest.get(appointmentId);
  if (!anchor) return null;
  return [...latest.values()].flatMap(row => {
    if (row.id === appointmentId) return [];
    const relationship = row.id === anchor.estimateId ? 'estimate' : row.estimateId === anchor.id || (anchor.estimateId && row.estimateId === anchor.estimateId) ? 'job' : 'contact';
    // Names/addresses/JK numbers alone never link people. Contact matches are
    // suggestions only, even with the same name: no account merge or conversion.
    if (relationship === 'contact' && !(normalized(anchor.customer).length >= 3 && normalized(anchor.customer) === normalized(row.customer) && ((anchor.phone && anchor.phone === row.phone) || (anchor.email && anchor.email === row.email)))) return [];
    const { phone: _phone, email: _email, estimateId: _estimateId, order: _order, ...record } = row;
    return [{ ...record, relationship } as CustomerHistoryRecord];
  }).sort((a, b) => Number(a.relationship === 'contact') - Number(b.relationship === 'contact') || b.date.localeCompare(a.date) || a.id.localeCompare(b.id));
}

// Project only the small history fields. Coalesce concurrent drawer requests and
// cache unchanged archives; the schedule refresh never calls this reader.
const fileCache = new Map<string, { signature: string; rows: Source[] }>();
let cache: { directory: string; until: number; value: Promise<{ rows: Source[]; coverage: CustomerHistory['coverage'] }> } | undefined;
async function archives(directory: string) {
  const names = (await fs.readdir(directory)).filter(name => /^junkware_\d{4}-\d{2}-\d{2}_raw\.json$/.test(name)).sort();
  if (!names.length) throw new Error('Saved history unavailable');
  const rows: Source[] = [], readableDates: string[] = [];
  let unreadable = 0;
  const present = new Set(names.map(name => path.join(directory, name)));
  for (const key of fileCache.keys()) if (!present.has(key)) fileCache.delete(key);
  for (let index = 0; index < names.length; index += 24) {
    const batch = await Promise.all(names.slice(index, index + 24).map(async name => {
      const file = path.join(directory, name), day = name.slice(9, 19);
      try {
        const stat = await fs.stat(file), signature = `${stat.mtimeMs}:${stat.size}`;
        let cached = fileCache.get(file);
        if (cached?.signature !== signature) {
          const payload = JSON.parse(await fs.readFile(file, 'utf8')), buckets = ['appointments', 'completed', 'cancelled'];
          if (!buckets.some(key => Array.isArray(payload[key])) || buckets.some(key => payload[key] !== undefined && !Array.isArray(payload[key]))) throw new Error('Invalid archive');
          cached = { signature, rows: buckets.flatMap(key => payload[key] || []).flatMap(row => row && typeof row === 'object' ? historySource(row, day, text(payload.scraped_at)) || [] : []) };
          fileCache.set(file, cached);
        }
        return { day, rows: cached.rows };
      } catch { unreadable++; return null; }
    }));
    for (const entry of batch) if (entry) { rows.push(...entry.rows); readableDates.push(entry.day); }
  }
  if (!readableDates.length) throw new Error('Saved history unavailable');
  return { rows, coverage: { from: readableDates[0], through: readableDates.at(-1)!, unreadable } };
}

export async function readCustomerHistory(appointmentId: string, date: string, dataDirectory = process.env.OPSBOT_DATA_DIR || path.join(process.env.HOME || '', '.openclaw/workspace/opsbot/data')): Promise<CustomerHistory | null> {
  const directory = path.join(dataDirectory, 'history/junkware');
  if (!cache || cache.directory !== directory || cache.until < Date.now()) {
    const entry = { directory, until: Date.now() + 30_000, value: archives(directory) };
    cache = entry;
    entry.value.catch(() => { if (cache === entry) cache = undefined; });
  }
  const { rows, coverage } = await cache.value;
  const latest = new Map<string, Source>();
  for (const row of rows) if (!latest.has(row.id) || row.order >= latest.get(row.id)!.order) latest.set(row.id, row);
  // Fresh saved observations can move/cancel an appointment. Keep its last
  // detailed amounts, but never let an old archive override the newer status.
  const today = chicagoDateKey();
  for (const day of new Set([date, today, addDays(today, 1)])) {
    const fast = readVerifiedJunkwareScheduleSnapshot(dataDirectory, day);
    if (!fast) continue;
    for (const raw of [...fast.appointments, ...fast.cancelled]) {
      const row = historySource({ ...raw, collection_timestamp: text(raw.status_observed_at) || fast.updatedAt }, day, fast.updatedAt);
      if (!row) continue;
      const old = latest.get(row.id);
      if (old && old.order > row.order) continue;
      latest.set(row.id, old ? { ...old, date: row.date, type: row.type || old.type, status: row.status || old.status, estimateId: row.estimateId || old.estimateId, order: row.order,
        customer: row.customer || old.customer, address: row.address || old.address, phone: row.phone || old.phone, email: row.email || old.email,
        amounts: row.type && row.type.toLowerCase() !== old.type.toLowerCase() ? [] : old.amounts,
      } : row);
    }
  }
  const records = relatedHistory([...latest.values()], appointmentId);
  return records ? { records: records.slice(0, 30), total: records.length, coverage } : null;
}
