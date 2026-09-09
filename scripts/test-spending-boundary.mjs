import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spendingViolations } from './verify-spending-boundary.mjs';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'spending-boundary-'));
const manifest = JSON.parse(fs.readFileSync(new URL('./approved-service-hosts.json', import.meta.url)));
try {
  for (const relative of new Set(['lib/maintenance-diagnosis.ts', 'lib/truck-load-photo-analysis.ts', ...Object.keys(manifest.protectedFiles || {})])) {
    fs.mkdirSync(path.dirname(path.join(root, relative)), {recursive:true});
    fs.copyFileSync(new URL(`../${relative}`, import.meta.url), path.join(root, relative));
  }
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({dependencies:{}}));
  assert.deepEqual(spendingViolations(root, manifest), []);
  const candidate = path.join(root, 'lib/new-service.ts');
  fs.writeFileSync(candidate, "fetch('https://api.anthropic.com/v1/messages')");
  assert(spendingViolations(root, manifest).some(x => x.includes('unapproved metered provider')));
  fs.writeFileSync(candidate, "fetch('https://unreviewed-provider.example/request')");
  assert(spendingViolations(root, manifest).some(x => x.includes('new external host')));
  fs.unlinkSync(candidate);
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({dependencies:{'new-provider-sdk':'1'}}));
  assert(spendingViolations(root, manifest).some(x => x.includes('New runtime dependency')));
  fs.writeFileSync(path.join(root, 'package.json'), '{}');
  fs.appendFileSync(path.join(root, 'lib/maintenance-diagnosis.ts'), '\n// changed control\n');
  assert(spendingViolations(root, manifest).some(x => x.includes('spending control changed')));
  console.log('Spending deployment regression checks passed: new providers, hosts, SDKs and altered controls are rejected.');
} finally { fs.rmSync(root, {recursive:true, force:true}); }
