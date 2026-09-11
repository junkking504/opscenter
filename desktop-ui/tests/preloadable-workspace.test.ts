import assert from 'node:assert/strict';
import { createElement, Suspense } from 'react';
import { renderToString } from 'react-dom/server';
import { preloadableWorkspace } from '../lib/preloadable-workspace';

async function main() {
  let calls = 0;
  const screen = preloadableWorkspace(async () => {
    calls++;
    return { default: ({ name }: { name: string }) => createElement('p', null, name) };
  });
  await Promise.all([screen.preload(), screen.preload()]);
  assert.equal(calls, 1, 'Hover, idle and navigation share the module import');
  const rendered = renderToString(createElement(Suspense, { fallback: 'Waiting for code' }, createElement(screen.Component, { name: 'Ready records' })));
  assert.ok(rendered.includes('<p>Ready records</p>'));
  assert.ok(!rendered.includes('Waiting for code'), 'A preloaded workspace does not suspend even on its first render');
  let attempts = 0;
  const retry = preloadableWorkspace(async () => {
    if (++attempts === 1) throw new Error('temporary asset outage');
    return { default: () => createElement('p', null, 'Recovered') };
  });
  await assert.rejects(retry.preload(), /temporary asset outage/);
  await retry.preload();
  assert.ok(renderToString(createElement(retry.Component)).includes('Recovered'));
  console.log('Preloaded workspace synchronous render and retry checks passed.');
}
void main();
