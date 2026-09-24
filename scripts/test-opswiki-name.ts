import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const userFacingFiles = [
  'desktop-ui/second-brain.tsx',
  'desktop-ui/live-search.tsx',
  'desktop-ui/knowledge-troubleshooting.tsx',
  'lib/knowledge-troubleshooting.ts',
  'lib/knowledge-seeds.ts',
  'docs/Home.md',
  'docs/background-maintenance.md',
  'docs/second-brain.md',
];

for (const file of userFacingFiles) {
  const contents = readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
  assert.doesNotMatch(contents, /Second Brain/i, `${file} still exposes the retired product name`);
}

const library = readFileSync(new URL('../desktop-ui/second-brain.tsx', import.meta.url), 'utf8');
assert.match(library, />OpsWiki</);
assert.match(library, /Ask OpsWiki/);
assert.match(library, /aria-label="OpsWiki answer"/);

const launcher = readFileSync(new URL('../desktop-ui/live-search.tsx', import.meta.url), 'utf8');
assert.match(launcher, /OpsWiki and Source Records/);
assert.match(launcher, /Checking OpsWiki/);

console.log('OpsWiki naming passed: navigation, library, instant answers, troubleshooting, seeds, and docs use the product name.');
