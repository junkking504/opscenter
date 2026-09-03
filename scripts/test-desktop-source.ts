import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { desktopReferenceAllowed } from '../lib/desktop-release';
import { desktopCommandKpis } from '../lib/desktop-command';
import { toOperationalAlert } from '../lib/operational-alert-presentation';

const hashes = JSON.parse(fs.readFileSync('desktop-ui/approved-source.json', 'utf8')).files as Record<string, string>;
// page.tsx intentionally gains data adapters; its CSS and primitives must not
// drift as those adapters are added. Geometry is also checked in the browser.
for (const file of ['app/globals.css', 'components/ui/badge.tsx', 'components/ui/button.tsx', 'components/ui/input.tsx', 'components/ui/textarea.tsx', 'package.json', 'package-lock.json']) {
  assert.equal(crypto.createHash('sha256').update(fs.readFileSync(`desktop-ui/${file}`)).digest('hex'), hashes[file], `${file} differs from the approved prototype`);
}
assert.equal(desktopReferenceAllowed('MAC_MINI_PREVIEW', 'reference', 'http://localhost:3103/desktop'), true);
assert.equal(desktopReferenceAllowed('MAC_MINI', 'reference', 'http://localhost:3000/desktop'), false);
assert.equal(desktopReferenceAllowed('MAC_MINI_PREVIEW', 'reference', 'https://ops.junk-king.app/desktop'), false);
assert.equal(desktopReferenceAllowed('MAC_MINI_PREVIEW', undefined, 'http://localhost:3103/desktop'), false);

const missing = desktopCommandKpis(null, null, 0);
assert.equal(missing.length, 8);
assert.ok(missing.every(kpi => kpi.value === '—'), 'An unavailable source must never be displayed as zero or a prototype value');
const schedule = { scheduled: 12, completedJobs: 4, closedEstimates: 2, closed: 6, unclosed: 6 };
const jobs = desktopCommandKpis(null, schedule, 0).find(kpi => kpi.label === 'Today’s jobs')!;
assert.equal(jobs.value, '12');
assert.equal(jobs.detail, '4 completed jobs · 2 closed estimates · 6 open');
assert.equal(Math.round(jobs.segments!.reduce((sum, segment) => sum + segment.value, 0)), 100);

const closed = toOperationalAlert({ id: 'synthetic-closeout', timestamp: '2026-09-03T18:00:00Z', channel: '#truck-9', threadReply: false, text: '', rawText: 'Job closed\nJK1234567\nDriver: Test Driver\nNavigator: Test Navigator', closeout: { jobNumber: 'JK1234567', lines: ['Load: $100.00', 'Total: $100.00'], href: '/jobs?appointment=123' } });
assert.ok(closed.facts.some(fact => fact.label === 'Krewe' && fact.value.includes('Test Driver') && fact.value.includes('Test Navigator')));
assert.equal(closed.href, '/jobs?appointment=123');
const photos = toOperationalAlert({ id: 'synthetic-photos', timestamp: '2026-09-03T18:00:00Z', channel: '#truck-9', threadReply: false, text: '', rawText: 'Photos uploaded\nJK1234567\n8 photos\nVerified in JunkWare' });
assert.equal(photos.needsAction, false);
assert.ok(photos.facts.some(fact => fact.label === 'Photos' && fact.value === '8 photos'));
assert.ok(photos.facts.some(fact => fact.label === 'Verification' && fact.value === 'Verified in JunkWare'));
console.log('Desktop source passed: exact CSS/primitives/lockfile, isolated reference gate, honest missing data, category-safe KPIs, and essential alert facts.');
