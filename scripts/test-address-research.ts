import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { addressResearchApproved, validateAddressResearchRequest } from '../lib/metered-usage-policy';
import { addressResearchRequest, parseResearchResponse, researchServiceAddress } from '../lib/address-research-provider';
import { researchAddressIdentity, validateAddressProposal } from '../lib/address-research-evidence';
import { officialAddressSource, publishedAddressEvidence } from '../lib/address-research-source';
import { investigateAddresses, researchKey, reserveAddressResearch } from '../lib/address-research';
import { initialMaintenanceState, monthKey, readMaintenanceState, saveMaintenanceState, reserveMaintenanceCall } from '../lib/maintenance-monitor';
import { publishAddressEvidence } from '../lib/address-research-store';
import type { AddressResearchItem, MaintenanceState } from '../desktop-ui/lib/maintenance-contract';

const address = '100 Example Boulevard Ste. 608, Baton Rouge, LA 70808';
const candidateAddress = '100 Example Blvd, Baton Rouge, LA 70808';
const source = 'https://www.example.gov/facility';
const point = { latitude: 30.4, longitude: -91.1 };
const proposal = { candidateAddress, explanation: 'Official premises address', sources: [source] };
const now = Date.parse('2026-09-13T15:00:00Z');
const approval = { id: 'address-investigation-20260913', enabled: true, provider: 'openai', model: 'gpt-5.6-luna', monthlyBudgetMicros: 10_000_000,
  sharedBudget: 'maintenance-diagnosis', perAddressBudgetMicros: 100_000, maxAttemptsPerAddress: 1, maxSearchCalls: 1, maxOutputTokens: 2048 };
const policy = { version: 1, default: 'deny', paused: false, approvals: { 'address-investigation': approval } };
const payload = { id: 'synthetic-response', model: 'gpt-5.6-luna', status: 'completed', usage: { input_tokens: 20000, output_tokens: 2000 },
  output: [{ type: 'web_search_call', action: { sources: [{ url: source }] } }, { type: 'message', content: [{ type: 'output_text', text: JSON.stringify(proposal) }] }] };
function readyState() {
  const state = initialMaintenanceState();
  state.addressResearch = { version: 1, checkedAt: null, status: '', items: { [researchKey(address)]: {
    address, dates: ['2026-09-14'], firstSeenAt: new Date(now).toISOString(), updatedAt: new Date(now).toISOString(), status: 'ready',
    attempts: 0, committedMicros: 0, estimatedMicros: 0, reason: 'No geocoder match',
  } } };
  return state;
}
async function main() {
  assert(addressResearchApproved(() => JSON.stringify(policy)));
  for (const change of [{ perAddressBudgetMicros: 200000 }, { monthlyBudgetMicros: 20000000 }, { sharedBudget: 'new-budget' }, { enabled: false }, { model: 'other' }, { maxAttemptsPerAddress: 2 }, { maxSearchCalls: 3 }]) {
    assert.equal(addressResearchApproved(() => JSON.stringify({ ...policy, approvals: { 'address-investigation': { ...approval, ...change } } })), false);
  }
  assert.equal(addressResearchApproved(() => JSON.stringify({ ...policy, paused: true })), false);
  assert.equal(addressResearchApproved(() => '{broken'), false);
  const request = addressResearchRequest(candidateAddress);
  for (const delta of [{ max_tool_calls: 3 }, { service_tier: 'priority' }, { model: 'other' }, { store: true }, { max_output_tokens: 4096 },
    { input: 'x'.repeat(10001) }, { previous_response_id: 'previous' }, { tools: [{ type: 'web_search', return_token_budget: 'unlimited' }] }]) {
    assert.throws(() => validateAddressResearchRequest({ ...request, ...delta }));
  }
  assert.deepEqual(parseResearchResponse(payload).proposal, proposal);
  assert(parseResearchResponse({ ...payload, model: 'other' }).error);
  const fabricated = structuredClone(payload); fabricated.output[1].content![0].text = JSON.stringify({ ...proposal, sources: ['https://fabricated.gov/'] });
  assert(parseResearchResponse(fabricated).error);
  const incomplete = { ...payload, status: 'incomplete' }; assert(parseResearchResponse(incomplete).error);
  let providerCalls = 0;
  const quota = await researchServiceAddress(candidateAddress, 'synthetic-key', (async () => { providerCalls++; return Response.json({ error: { code: 'insufficient_quota', message: 'private diagnostic' } }, { status: 429 }); }) as typeof fetch);
  assert.equal(quota.error, 'OpenAI API quota unavailable'); assert.equal(providerCalls, 1); assert(!JSON.stringify(quota).includes('private diagnostic'));

  assert.equal(researchAddressIdentity(address), researchAddressIdentity(candidateAddress));
  assert.equal(researchKey(address), researchKey('100 Example Blvd 608, Baton Rouge, 70808'));
  for (const changed of ['101 Example Blvd, Baton Rouge, LA 70808', '100 Other Blvd, Baton Rouge, LA 70808', '100 Example Blvd, Other City, LA 70808', '100 Example Blvd, Baton Rouge, LA 70809']) {
    assert.notEqual(researchKey(changed), researchKey(address));
    const invalid = await validateAddressProposal(address, { ...proposal, candidateAddress: changed }, async () => { throw new Error('must not lookup'); });
    assert.equal(invalid.location, null);
  }
  assert.equal(researchAddressIdentity('100 Example Blvd or 200 Other Street, Baton Rouge LA 70808'), null);
  const ld = { '@type': 'MedicalClinic', address: { streetAddress: '100 Example Boulevard', addressLocality: 'Baton Rouge', addressRegion: 'LA', postalCode: '70808', addressCountry: 'US' }, geo: { latitude: point.latitude, longitude: point.longitude } };
  const html = (value: unknown) => `<script type="application/ld+json">${JSON.stringify(value)}</script>`;
  assert.deepEqual(publishedAddressEvidence(address, html(ld), source)?.location, point);
  for (const bad of [ { ...ld, '@type': 'Person' }, { ...ld, geo: { latitude: null, longitude: null } },
    { ...ld, geo: { latitude: 0, longitude: 0 } }, { ...ld, address: { ...ld.address, streetAddress: '101 Example Blvd' } },
    [ld, { ...ld, geo: { latitude: 30.5, longitude: -91.2 } }] ]) assert.equal(publishedAddressEvidence(address, html(bad), source), null);
  for (const url of ['http://example.gov/', 'https://example.gov.evil.com/', 'https://user:password@example.gov/', 'https://127.0.0.1/', 'https://example.gov:444/']) assert.equal(officialAddressSource(url), null);
  const supported = await validateAddressProposal(address, proposal, async () => ({ location: null, reason: 'no match' }), async () => publishedAddressEvidence(address, html(ld), source));
  assert.deepEqual(supported.location, point);
  const disagreement = await validateAddressProposal(address, { ...proposal, sources: [source, 'https://other.gov/'] }, async () => ({ location: null, reason: 'no match' }), async (_, url) => ({location: url === source ? point : {latitude:30.5,longitude:-91.2},reason:'published',sources:[url]}));
  assert.equal(disagreement.location, null);

  const candidates = [{ address, dates: ['2026-09-14'], located: false }, { address: candidateAddress, dates: ['2026-09-15'], located: false }];
  const state = initialMaintenanceState(); let paid = 0, saved = 0, reservedBeforeRequest = false;
  const persist = () => { if (state.addressResearch?.items[researchKey(address)]?.status === 'researching') reservedBeforeRequest = true; };
  const deps = { candidates, now, approved: () => true, lookup: async () => ({ location: null, reason: 'no match' }),
    research: async () => { paid++; assert(reservedBeforeRequest); return parseResearchResponse(payload); }, validate: async () => supported, publish: () => { saved++; } };
  await investigateAddresses(state, 'synthetic-key', persist, deps);
  assert.equal(paid, 0, 'Formatting and ordinary providers get a free attempt first');
  assert.equal(Object.keys(state.addressResearch!.items).length, 1, 'Equivalent suites and dates share one lifetime allowance');
  await investigateAddresses(state, 'synthetic-key', persist, { ...deps, now: now + 60000 });
  assert.equal(paid, 1); assert.equal(saved, 2); assert.equal(state.addressResearch!.items[researchKey(address)].status, 'resolved');
  assert.equal(state.months[monthKey(now)].estimatedMicros, 16400, 'Token usage plus the search fee are both charged');
  await investigateAddresses(state, 'synthetic-key', persist, { ...deps, now: Date.parse('2026-10-01T15:00:00Z') });
  assert.equal(paid, 1, 'New month and recurrent missing pin do not reset address attempt history');
  const nearCap = readyState(); nearCap.months[monthKey(now)] = { committedMicros: 9950000, estimatedMicros: 9950000, calls: 100, inputTokens: 0, outputTokens: 0 };
  await investigateAddresses(nearCap, 'synthetic-key', () => {}, deps); assert.equal(paid, 1, 'Existing maintenance usage consumes the same ceiling');
  assert(reserveMaintenanceCall(nearCap, now));
  assert.equal(reserveAddressResearch(nearCap, nearCap.addressResearch!.items[researchKey(address)], now), false);
  const failed = readyState();
  await investigateAddresses(failed, 'synthetic-key', () => {}, { ...deps, research: async () => ({ error: 'OpenAI HTTP 429' }) });
  assert.equal(failed.months[monthKey(now)].committedMicros, 100000); assert.equal(failed.addressResearch!.items[researchKey(address)].committedMicros, 100000);
  assert(failed.aiRetryAfter); const failureSaved = saved;
  await investigateAddresses(failed, 'synthetic-key', () => {}, deps); assert.equal(saved, failureSaved); assert.equal(paid, 1);
  const crashed = readyState(); const crashRow = crashed.addressResearch!.items[researchKey(address)]; reserveAddressResearch(crashed, crashRow, now);
  await investigateAddresses(crashed, 'synthetic-key', () => {}, deps); assert.equal(crashRow.status, 'provider_error'); assert.equal(crashRow.attempts, 1);
  const denied = readyState(); await investigateAddresses(denied, 'synthetic-key', () => {}, { ...deps, approved: () => false }); assert.equal(paid, 1);
  const paused = readyState(); paused.aiRetryAfter = new Date(now+3600000).toISOString(); await investigateAddresses(paused, 'synthetic-key', () => {}, deps); assert.equal(paid,1);

  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'address-research-test-'));
  try {
    saveMaintenanceState(state, directory); fs.writeFileSync(path.join(directory,'address-research-initialized'),'1');
    assert.equal(readMaintenanceState(directory).addressResearch!.items[researchKey(address)].attempts,1);
    saveMaintenanceState(initialMaintenanceState(), directory); assert.throws(() => readMaintenanceState(directory), /paused/);
    publishAddressEvidence(address, supported, directory); publishAddressEvidence(address, supported, directory);
    assert.throws(() => publishAddressEvidence(address, {...supported,location:{latitude:30.5,longitude:-91.2}},directory),/conflicts/);
    const records = fs.readdirSync(path.join(directory,'cache/service-address-reviews'));
    const record = JSON.parse(fs.readFileSync(path.join(directory,'cache/service-address-reviews',records[0]),'utf8'));
    assert.deepEqual(record.location,point); assert.equal(record.originalAddress,address); assert.deepEqual(record.sources,[source]);
  } finally { fs.rmSync(directory,{recursive:true,force:true}); }
  console.log('Address investigation passed: evidence provenance, exact premises, conflicting sources, shared and lifetime caps, request bounds, crash/429 handling, deduplication, fail-closed ledger and cache read-back. Synthetic data; no paid calls.');
}
main().catch(error => {console.error(error);process.exitCode=1;});
