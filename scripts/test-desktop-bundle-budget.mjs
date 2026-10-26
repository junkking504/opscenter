// Fails when the desktop shell or a workspace grows past its download budget.
// Run after `npm run build:desktop`. Sizes are gzip bytes, as browsers receive them.
// Raise a budget only with a reason in the commit; lowering one locks in a win.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';

const root = new URL('../public/desktop-assets/', import.meta.url);
const manifest = JSON.parse(readFileSync(new URL('.vite/manifest.json', root), 'utf8'));
const kb = file => gzipSync(readFileSync(new URL(file, root))).length / 1024;

const budgets = {
  shellScript: 260,
  shellStylesheet: 105,
  // Allow 0.1 KB for theme-token and shared-chunk filename churn; the prior Fleet build was only 7 bytes below 50 KB.
  workspace: { 'live-schedule.tsx': 135, 'live-krewe.tsx': 30, 'live-fleet.tsx': 50.1, 'live-finance.tsx': 170, 'live-marketing.tsx': 20 },
};

const entry = manifest['index.html'];
const rows = [['Shell script', kb(entry.file), budgets.shellScript]];
for (const css of entry.css || []) rows.push(['Shell stylesheet', kb(css), budgets.shellStylesheet]);

// A workspace's cost is its own chunk plus shared chunks it loads, never the shell.
for (const [key, budget] of Object.entries(budgets.workspace)) {
  assert.ok(manifest[key], `${key} is no longer a separate chunk; update the budget list.`);
  const files = new Set();
  const visit = name => {
    if (name === 'index.html' || !manifest[name]) return;
    const item = manifest[name];
    if (files.has(item.file)) return;
    files.add(item.file);
    item.css?.forEach(file => files.add(file));
    item.imports?.forEach(visit);
  };
  visit(key);
  rows.push([key.replace(/\.tsx$/, ''), [...files].reduce((sum, file) => sum + kb(file), 0), budget]);
}

console.table(rows.map(([name, size, budget]) => ({ name, gzipKb: Math.round(size), budgetKb: budget })));
const over = rows.filter(([, size, budget]) => size > budget);
assert.equal(over.length, 0, `Over budget: ${over.map(([name, size, budget]) => `${name} ${Math.round(size)} KB > ${budget} KB`).join(', ')}`);

// Schedule's styles live in the shell stylesheet so the cascade order never
// depends on whether its code has loaded (see desktop-ui/live-schedule-styles.ts).
assert.deepEqual(manifest['live-schedule.tsx'].css || [], [], 'Schedule must not ship its own stylesheet; add it to live-schedule-styles.ts.');
console.log('PASS: desktop shell and workspace downloads are within budget');
