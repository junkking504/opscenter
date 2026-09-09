import fs from 'node:fs';
import path from 'node:path';
import { junkwareJobPhotos, junkwarePhotoAuditAvailable } from './junkware-job-details';
import type { SourceEstimate } from '../desktop-ui/lib/schedule-contract';

type Row = Record<string, unknown>;
const text = (value: unknown) => String(value ?? '').trim();
function amount(value: unknown): number | null {
  const raw = text(value).replace(/[$,]/g, '');
  return /^\d+(?:\.\d{1,2})?$/.test(raw) && Number.isFinite(Number(raw)) ? Number(raw) : null;
}

export function sourceEstimateFromRow(row: Row, date: string): SourceEstimate | null {
  const appointmentId = text(row.appt_id || row.appointment_id);
  if (!/^\d+$/.test(appointmentId) || !/estimate/i.test(text(row.final_appointment_type || row.appointment_type))) return null;
  const charges = row.closeout && typeof row.closeout === 'object' ? row.closeout as Row : {};
  return {
    appointmentId, jkNumber: text(row.job_id || row.jk_number), date: text(row.appointment_date) || date,
    total: amount(charges.total),
    chargeSummary: [
      text(charges.loadSize) && `${text(charges.loadQuantity) || '1'} × ${text(charges.loadSize)}`,
      text(charges.bedloadSize) && !/^none$/i.test(text(charges.bedloadSize)) && `${text(charges.bedloadQuantity) || '1'} × ${text(charges.bedloadSize)}`,
      ...(Array.isArray(charges.otherCharges) ? charges.otherCharges.map((charge: Row) => text(charge.name)).filter(Boolean) : []),
    ].filter(Boolean).join(' · '),
    photos: junkwareJobPhotos(row), photoAuditAvailable: junkwarePhotoAuditAvailable(row),
    observedAt: text(row.closeout_verified_at || row.collection_timestamp),
  };
}

// Cache each archive independently: today's changing file must not cause every
// historical file to be parsed again on Schedule's five-second refresh.
const files = new Map<string, { signature: string; rows: SourceEstimate[] }>();
export function readSourceEstimates(ids: string[], jobDate: string, dataDir = process.env.OPSBOT_DATA_DIR || path.join(process.env.HOME || '', '.openclaw/workspace/opsbot/data')) {
  const wanted = new Set(ids.filter(id => /^\d+$/.test(id)));
  const found = new Map<string, SourceEstimate>();
  if (!wanted.size) return found;
  const directory = path.join(dataDir, 'history/junkware');
  let names: string[];
  try { names = fs.readdirSync(directory); } catch { return found; }
  for (const name of names.sort()) {
    const match = name.match(/^junkware_(\d{4}-\d{2}-\d{2})_raw\.json$/);
    if (!match || match[1] > jobDate) continue;
    const file = path.join(directory, name);
    try {
      const stat = fs.statSync(file), signature = `${stat.mtimeMs}:${stat.size}`;
      let cached = files.get(file);
      if (cached?.signature !== signature) {
        const payload = JSON.parse(fs.readFileSync(file, 'utf8'));
        const rows = ['appointments', 'completed', 'cancelled'].flatMap(key => Array.isArray(payload[key]) ? payload[key] : []);
        cached = { signature, rows: rows.flatMap(row => sourceEstimateFromRow(row, match[1]) || []) };
        files.set(file, cached);
      }
      for (const estimate of cached.rows) {
        if (!wanted.has(estimate.appointmentId) || estimate.date > jobDate) continue;
        const previous = found.get(estimate.appointmentId);
        if (!previous || (Date.parse(estimate.observedAt) || 0) >= (Date.parse(previous.observedAt) || 0)) found.set(estimate.appointmentId, estimate);
      }
    } catch { /* Unreadable history stays unavailable; never guess by customer/JK. */ }
  }
  return found;
}
