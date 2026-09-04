import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { buildSearchKingsView, saveLostLeadOverride, type LostLeadStatus, type LostLeadReason, type SearchKingsLead } from '@/lib/searchkings';
import { buildPodiumGoogleReviewsView } from '@/lib/podium-reviews';
import { assignPodiumReviewToAppointment, podiumReviewNameSuggestions, readPodiumReviewAssignments } from '@/lib/podium-review-assignments';
import { addDays } from '@/lib/report-dates';
import { opsRoleCan, type InteractiveOpsRole } from '@/lib/ops-roles';
import type { CommercialOperation, CommercialReceipt, MarketingData } from '../desktop-ui/lib/commercial-contract';
export class CommercialActionError extends Error { constructor(message: string, readonly stage: 'preflight' | 'uncertain' = 'preflight') { super(message); this.name = 'CommercialActionError'; } }
export const commercialVersion = (record: unknown) => createHash('sha256').update(JSON.stringify(record)).digest('hex');
export const commercialDirectory = () => process.env.OPSCENTER_DESKTOP_COMMERCIAL_DIR || path.join(process.cwd(), 'data', 'desktop-commercial');
export function validCommercialDate(date: string) { return /^\d{4}-\d{2}-\d{2}$/.test(date) && Number.isFinite(Date.parse(date)) && new Date(`${date}T12:00:00Z`).toISOString().slice(0, 10) === date; }
export function authoritativeMarketingTotals(leads: SearchKingsLead[]) {
  const appointments = [...new Map(leads.filter(lead => lead.matchedAppointment?.appointmentId).map(lead => [lead.matchedAppointment!.appointmentId, lead.matchedAppointment!])).values()];
  return { bookings: appointments.length, completed: appointments.filter(appointment => appointment.completed).length, revenue: appointments.filter(appointment => appointment.completed).reduce((sum, appointment) => sum + (appointment.revenue ?? 0), 0) };
}
export function readDesktopMarketing(date: string, role: InteractiveOpsRole): MarketingData {
  const source = buildSearchKingsView(date.slice(0, 7));
  const podium = buildPodiumGoogleReviewsView();
  const reviews = podium.locations.flatMap(location => location.reviews.map(review => ({ ...review, location: location.name })));
  const suggestions = podiumReviewNameSuggestions(reviews.map(review => ({ uid: review.uid, authorName: review.authorName, createdAt: review.createdAt, locationName: review.location })));
  const totals = authoritativeMarketingTotals(source.leads);
  const end = source.snapshot?.range.endDate;
  const recentStart = end ? addDays(end, -6) : '';
  const previousStart = recentStart ? addDays(recentStart, -7) : '';
  const comparisonAvailable = Boolean(source.snapshot && previousStart && source.snapshot.range.startDate <= previousStart);
  const recent = authoritativeMarketingTotals(source.leads.filter(lead => lead.calledDate >= recentStart)).bookings;
  const previous = authoritativeMarketingTotals(source.leads.filter(lead => lead.calledDate >= previousStart && lead.calledDate < recentStart)).bookings;
  return { date, range: source.rangeLabel, fetchedAt: source.snapshot?.fetchedAt || null, available: source.available, error: source.error || null, canAssignReviews: opsRoleCan(role, 'sensitive.write'), reviewAvailable: podium.available, reviewFetchedAt: podium.snapshot?.fetchedAt || null, reviewError: podium.error || null,
    leads: source.leads.map(lead => ({ id: lead.callId, version: commercialVersion(lead), customer: lead.callerName || 'Name unavailable', phone: lead.phone, territory: lead.territory, intent: lead.summary || 'Call intent unavailable', quotedValue: lead.potentialRevenue, status: lead.status, reason: lead.reason, note: lead.note, contacted: lead.franchiseContacted, calledAt: lead.calledAt, updatedAt: lead.updatedAt, source: lead.source, sourceUrl: lead.searchKingsUrl, appointmentId: lead.matchedAppointment?.appointmentId || null, jk: lead.matchedAppointment?.jobId || null, completed: lead.matchedAppointment?.completed || false, revenue: lead.matchedAppointment?.revenue ?? null })),
    reviews: reviews.map(review => ({ id: review.uid, version: commercialVersion(review), customer: review.authorName, location: review.location, excerpt: review.body, stars: review.rating, createdAt: review.createdAt, sourceUrl: review.url, attribution: review.attribution || null, candidates: (suggestions[review.uid] || []).map(candidate => ({ appointmentId: candidate.appointmentId, jkNumber: candidate.jkNumber, label: candidate.label })) })),
    totals: { calls: source.totalCalls, qualified: source.qualifiedCalls, ...totals, cost: source.spend },
    sources: source.territoryRows.map(row => { const leads = source.leads.filter(lead => lead.territory === row.territory); return { source: row.territory, calls: leads.length, qualified: row.qualifiedCalls, ...authoritativeMarketingTotals(leads), cost: row.spend }; }),
    jobChange: comparisonAvailable ? `Matched appointments: last 7 days ${recent} · prior 7 days ${previous}` : 'Prior 7-day comparison unavailable' };
}
/** Registered local action definitions: writes retain attribution and immutable receipts. */
export const COMMERCIAL_ACTIONS = { 'lead.update': 'operations.write', 'review.assign': 'sensitive.write', 'resale.save': 'sensitive.write', 'recycling.save': 'sensitive.write' } as const;
export function parseCommercialOperation(body: unknown): CommercialOperation {
  if (!body || typeof body !== 'object') throw new CommercialActionError('A typed change is required.');
  const value = body as CommercialOperation;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value.requestId) || !validCommercialDate(value.date) || !Object.hasOwn(COMMERCIAL_ACTIONS, value.action) || typeof value.recordId !== 'string' || !value.recordId || value.recordId.length > 200 || !/^[a-f0-9]{64}$/.test(value.expectedVersion) || !value.values || typeof value.values !== 'object' || JSON.stringify(value.values).length > 12000) throw new CommercialActionError('A valid record, date, version, action, and request ID are required.');
  return value;
}
function receiptFile(id: string) { return path.join(commercialDirectory(), `${id}.json`); }
export function readCommercialReceipt(id: string): CommercialReceipt | null { if (!/^[a-f0-9-]{36}$/i.test(id)) return null; try { return JSON.parse(fs.readFileSync(receiptFile(id), 'utf8')); } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null; throw error; } }
function writeReceipt(receipt: CommercialReceipt) { const file = receiptFile(receipt.requestId); fs.writeFileSync(`${file}.tmp`, JSON.stringify(receipt), { mode: 0o600 }); fs.renameSync(`${file}.tmp`, file); }
/** Synchronous critical section also serializes separate server workers. Crash locks require operator inspection; never auto-replay uncertain writes. */
export function executeCommercialOperation(operation: CommercialOperation, actor: { email: string; role: InteractiveOpsRole }, loadVersion: () => string | undefined, writeAndVerify: () => boolean): CommercialReceipt {
  if (!opsRoleCan(actor.role, COMMERCIAL_ACTIONS[operation.action])) throw new CommercialActionError('Manager permission is required for this action.');
  fs.mkdirSync(commercialDirectory(), { recursive: true, mode: 0o700 });
  const lock = path.join(commercialDirectory(), '.write-lock');
  try { fs.mkdirSync(lock); } catch { throw new CommercialActionError('Another commercial change is in progress or requires recovery. Refresh before continuing.'); }
  let sourceMayHaveChanged = false;
  try {
    const fingerprint = commercialVersion(operation);
    const existing = readCommercialReceipt(operation.requestId);
    if (existing) { if (existing.fingerprint !== fingerprint || existing.actor !== actor.email) throw new CommercialActionError('Request ID belongs to another change.'); return existing; }
    for (const file of fs.readdirSync(commercialDirectory()).filter(name => name.endsWith('.json'))) {
      const receipt = readCommercialReceipt(file.slice(0, -5));
      if (receipt?.recordId === operation.recordId && receipt.action === operation.action && receipt.status !== 'verified') throw new CommercialActionError('This record has an unverified change. Inspect its saved receipt before another change.');
    }
    if (loadVersion() !== operation.expectedVersion) throw new CommercialActionError('The record changed. Refresh and review the current version.');
    const fields = operation.action === 'lead.update' ? ['status', 'reason', 'note', 'contacted'] : operation.action === 'review.assign' ? ['appointmentId'] : operation.action === 'resale.save' ? ['itemName', 'source', 'acquiredDate', 'status', 'cost', 'askingPrice', 'soldPrice', 'marketplace', 'notes'] : ['material', 'sourceJob', 'yard', 'quantity', 'owner', 'ticket', 'paymentReference', 'note', 'status', 'expectedValue', 'realizedValue'];
    const input = Object.fromEntries(fields.map(key => [key, operation.values[key]]));
    let receipt: CommercialReceipt = { expectedVersion: operation.expectedVersion, input, permission: COMMERCIAL_ACTIONS[operation.action], authority: 'opscenter_authoritative', requestId: operation.requestId, recordId: operation.recordId, action: operation.action, actor: actor.email, fingerprint, status: 'pending', updatedAt: new Date().toISOString(), message: 'Verifying saved OpsCenter state.' };
    writeReceipt(receipt);
    sourceMayHaveChanged = true;
    try { const verified = writeAndVerify(); receipt = { ...receipt, status: verified ? 'verified' : 'uncertain', message: verified ? 'OpsCenter record saved and read back. External source data is unchanged.' : 'Save could not be verified. Inspect the record before retrying.' }; } catch { receipt = { ...receipt, status: 'uncertain', message: 'Save result is uncertain. Inspect the record before retrying.' }; }
    receipt.updatedAt = new Date().toISOString(); writeReceipt(receipt); return receipt;
  } catch (error) {
    if (!sourceMayHaveChanged && error instanceof CommercialActionError) throw error;
    throw new CommercialActionError(sourceMayHaveChanged ? 'The saved result could not be persisted. Inspect the source and saved receipt before another change.' : 'The change could not start. No business record was written.', sourceMayHaveChanged ? 'uncertain' : 'preflight');
  } finally { fs.rmdirSync(lock); }
}
export function updateDesktopMarketing(operation: CommercialOperation, actor: { email: string; role: InteractiveOpsRole }) {
  if (operation.action === 'lead.update') {
    const status = String(operation.values.status || '') as LostLeadStatus;
    const reason = String(operation.values.reason || '') as LostLeadReason;
    const note = String(operation.values.note || '').trim();
    if (!['needs_follow_up', 'booked', 'lost', 'recovered', 'unqualified'].includes(status) || !['', 'availability', 'pricing', 'missed_call', 'no_follow_up', 'competitor', 'out_of_area', 'service_not_offered', 'customer_declined', 'other'].includes(reason) || note.length > 2000 || typeof operation.values.contacted !== 'boolean') throw new CommercialActionError('Choose a valid lead outcome and note.');
    return executeCommercialOperation(operation, actor, () => readDesktopMarketing(operation.date, actor.role).leads.find(lead => lead.id === operation.recordId)?.version, () => {
      const entry = saveLostLeadOverride({ callId: operation.recordId, status, reason, note, franchiseContacted: operation.values.contacted === true, updatedBy: actor.email });
      const saved = readDesktopMarketing(operation.date, actor.role).leads.find(lead => lead.id === operation.recordId);
      return Boolean(entry && saved && (saved.appointmentId ? ['booked', 'recovered'].includes(saved.status) : saved.status === status) && saved.note === note && saved.contacted === operation.values.contacted);
    });
  }
  if (operation.action !== 'review.assign') throw new CommercialActionError('Unsupported Marketing action.');
  const reference = String(operation.values.appointmentId || '').trim();
  if (!/^\d{1,12}$/.test(reference)) throw new CommercialActionError('Select a source appointment ID, not a JK-only reference.');
  return executeCommercialOperation(operation, actor, () => readDesktopMarketing(operation.date, actor.role).reviews.find(review => review.id === operation.recordId)?.version, () => {
    const assignment = assignPodiumReviewToAppointment({ reviewUid: operation.recordId, appointmentReference: reference, assignedBy: actor.email });
    return Boolean(assignment && readPodiumReviewAssignments().some(saved => saved.reviewUid === operation.recordId && saved.attribution.appointmentId === assignment.attribution.appointmentId && saved.assignedBy === actor.email));
  });
}
