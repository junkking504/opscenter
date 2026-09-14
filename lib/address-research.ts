import { createHash } from 'node:crypto';
import type { MaintenanceState, AddressResearchItem } from '../desktop-ui/lib/maintenance-contract';
import { ADDRESS_RESEARCH_LIMIT_MICROS, addressResearchApproved } from './metered-usage-policy';
import { MONTHLY_BUDGET_MICROS, monthKey } from './maintenance-monitor';
import { researchAddressIdentity, validateAddressProposal, type AddressEvidence } from './address-research-evidence';
import { researchServiceAddress, type AddressProposal, type ResearchResponse } from './address-research-provider';
import { verifyDesktopAddress, type AddressVerification } from './desktop-address-verification';

export type AddressCandidate = { address: string; dates: string[]; located: boolean };
type Dependencies = {
  candidates: AddressCandidate[]; lookup?: (address: string) => Promise<AddressVerification>;
  research?: (address: string, key: string) => Promise<ResearchResponse>;
  validate?: (address: string, proposal: AddressProposal) => Promise<AddressEvidence>;
  publish: (address: string, evidence: AddressEvidence) => void;
  approved?: () => boolean; now?: number;
};
export const researchKey = (address: string) => createHash('sha256').update(researchAddressIdentity(address) || address.trim().toUpperCase()).digest('hex');

export function reserveAddressResearch(state: MaintenanceState, row: AddressResearchItem, now: number): boolean {
  const ledger = state.months[monthKey(now)] ||= { committedMicros: 0, estimatedMicros: 0, calls: 0, inputTokens: 0, outputTokens: 0 };
  if (row.attempts !== 0 || row.committedMicros !== 0 || ledger.calls >= 500
    || ledger.committedMicros + ADDRESS_RESEARCH_LIMIT_MICROS > MONTHLY_BUDGET_MICROS) return false;
  // Reserve the entire lifetime address allowance before the request. One
  // bounded search run; no repeated paid retry after a crash or date change.
  ledger.committedMicros += ADDRESS_RESEARCH_LIMIT_MICROS; ledger.calls++;
  row.committedMicros = ADDRESS_RESEARCH_LIMIT_MICROS; row.attempts = 1; row.status = 'researching';
  return true;
}

export function settleAddressResearch(state: MaintenanceState, row: AddressResearchItem, result: ResearchResponse, now: number) {
  if (result.inputTokens === undefined || result.outputTokens === undefined || result.searches === undefined) return;
  const micros = Math.ceil(result.inputTokens * 0.2 + result.outputTokens * 1.2 + result.searches * 10_000);
  const ledger = state.months[monthKey(now)];
  ledger.estimatedMicros += micros; ledger.inputTokens += result.inputTokens; ledger.outputTokens += result.outputTokens;
  ledger.committedMicros += micros - row.committedMicros;
  row.estimatedMicros = micros; row.committedMicros = micros;
  if (micros > ADDRESS_RESEARCH_LIMIT_MICROS || result.searches > 1 || result.outputTokens > 2048 || result.inputTokens > 300_000) {
    state.aiStatus = 'AI paused: unexpected usage requires pricing review';
  }
}

export async function investigateAddresses(state: MaintenanceState, apiKey: string, persist: () => void, deps: Dependencies): Promise<boolean> {
  const now = deps.now ?? Date.now(), at = new Date(now).toISOString(), approved = deps.approved || addressResearchApproved;
  const queue = state.addressResearch ||= { version: 1, checkedAt: null, status: 'Waiting for unresolved addresses', items: {} };
  queue.checkedAt = at;
  const groups = new Map<string, AddressCandidate>();
  for (const candidate of deps.candidates) {
    const key = researchKey(candidate.address), prior = groups.get(key);
    if (prior) { prior.dates = [...new Set([...prior.dates, ...candidate.dates])]; prior.located &&= candidate.located; }
    else groups.set(key, { ...candidate, dates: [...candidate.dates] });
  }
  for (const [key, candidate] of groups) {
    let row = queue.items[key];
    if (!row && candidate.located) continue;
    row ||= queue.items[key] = { address: candidate.address, dates: candidate.dates, firstSeenAt: at, updatedAt: at,
      status: 'queued', attempts: 0, committedMicros: 0, estimatedMicros: 0, reason: 'Queued automatically after ordinary geocoding' };
    row.dates = candidate.dates;
    if (candidate.located) { row.status = 'resolved'; row.reason = 'Verified location is available to Schedule'; row.updatedAt = at; }
    else if (row.status === 'researching') { row.status = 'provider_error'; row.reason = 'Previous run interrupted; reservation retained'; row.updatedAt = at; }
    else if (row.status === 'inactive' || row.status === 'resolved') { row.status = row.attempts ? 'unresolved' : 'queued'; row.updatedAt = at; }
  }
  for (const [key, row] of Object.entries(queue.items)) if (!groups.has(key)) row.status = 'inactive';
  const pending = Object.entries(queue.items).filter(([,r]) => ['queued','ready'].includes(r.status))
    // Free lookups continue while paid work is cooling down. Rotate deferred
    // lookups by last attempt so one unavailable provider cannot hold the queue.
    .sort(([,a],[,b]) => Number(b.status === 'queued') - Number(a.status === 'queued')
      || a.updatedAt.localeCompare(b.updatedAt) || (a.dates[0] || '').localeCompare(b.dates[0] || ''));
  queue.status = pending.length ? `${pending.length} addresses queued for investigation` : 'No new addresses awaiting investigation';
  persist();
  if (!approved()) { queue.status = 'Address investigation paused: spending approval required'; persist(); return false; }
  const [key, row] = pending[0] || [];
  if (!row) return false;
  const identity = researchAddressIdentity(row.address);
  if (!identity) { row.status = 'unresolved'; row.reason = 'Source does not identify one complete street address'; row.updatedAt = at; persist(); return false; }
  // Give formatting variants a free lookup before buying research. This tick
  // stops after the lookup so the observer retains its finite execution bound.
  if (row.status === 'queued') {
    const result = await (deps.lookup || verifyDesktopAddress)(identity);
    if (result.location) {
      const evidence = { ...result, sources: result.sourceUrl ? [result.sourceUrl] : ['https://geocoding.geo.census.gov/'], precision: 'verified-service-premises' };
      try {
        for (const candidate of deps.candidates.filter(c => researchKey(c.address) === key)) deps.publish(candidate.address, evidence);
        row.status = 'resolved'; row.reason = result.reason;
      } catch { row.status = 'unresolved'; row.reason = 'Verified evidence could not be saved; existing cache retained'; }
    } else if (result.retryAfterMs) { row.reason = 'Ordinary geocoder deferred; no paid research requested'; }
    else { row.status = 'ready'; row.reason = result.reason; }
    row.updatedAt = at; persist(); return true;
  }
  if (!apiKey) { queue.status = 'Address investigation paused: credential unavailable'; persist(); return false; }
  if (state.aiStatus.startsWith('AI paused: unexpected usage')) { queue.status = state.aiStatus; persist(); return false; }
  if (state.aiRetryAfter && now < Date.parse(state.aiRetryAfter)) { queue.status = `Provider cooling down until ${state.aiRetryAfter}`; persist(); return false; }
  if (!approved() || !reserveAddressResearch(state, row, now)) { queue.status = 'Shared budget or address allowance reached'; persist(); return false; }
  row.updatedAt = at;
  state.receipts.push({ at, incident: `address:${key}`, event: 'Address investigation reserved $0.10 in the shared monthly ledger' });
  persist();
  const result = await (deps.research || researchServiceAddress)(identity, apiKey).catch(() => ({ error: 'Research request interrupted or unavailable' } as ResearchResponse));
  settleAddressResearch(state, row, result, now);
  if ((result.searches ?? 0) > 1 || result.error === 'Unexpected model; research paused') state.aiStatus = 'AI paused: unexpected usage requires pricing review';
  row.responseId = result.responseId;
  // Persist accounting before source validation or cache publication.
  row.status = 'unresolved'; row.updatedAt = new Date().toISOString(); persist();
  if (state.aiStatus.startsWith('AI paused: unexpected usage')) { queue.status = state.aiStatus; row.reason = state.aiStatus; persist(); return true; }
  if (!result.proposal || result.error) {
    row.status = 'provider_error'; row.reason = result.error || 'Research supplied no usable evidence';
    queue.status = row.reason; state.aiRetryAfter = new Date(now + 3_600_000).toISOString();
  } else {
    row.candidate = result.proposal.candidateAddress; row.sources = result.proposal.sources;
    const evidence = await (deps.validate || validateAddressProposal)(row.address, result.proposal).catch(() => ({ location: null, reason: 'Independent evidence could not be verified', sources: result.proposal!.sources } as AddressEvidence));
    row.reason = evidence.reason;
    if (evidence.location) {
      try {
        for (const candidate of deps.candidates.filter(c => researchKey(c.address) === key)) deps.publish(candidate.address, evidence);
        row.status = 'resolved'; row.sources = evidence.sources; queue.status = 'Address resolved and published to Schedule';
      } catch { row.reason = 'Verified evidence could not be saved; existing cache retained'; queue.status = row.reason; }
    } else queue.status = 'Investigation finished; precise location remains unsupported';
  }
  state.receipts.push({ at: row.updatedAt, incident: `address:${key}`, event: row.status === 'resolved' ? 'Independent address evidence verified and saved' : row.reason });
  state.receipts = state.receipts.slice(-200); persist(); return true;
}
