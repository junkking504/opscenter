import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
for (const target of ['', 'cloudflare']) {
  process.env.OPSCENTER_BUILD_TARGET = target;
  const { default: config } = await import(`../next.config.mjs?target=${target}`);
  const tracer = { constructor: { name: 'TraceEntryPointsPlugin' }, traceIgnores: [] };
  const replacements = [];
  class NormalModuleReplacementPlugin { constructor(pattern, replacement) { replacements.push({ pattern, replacement }); } }
  const webpack = config.webpack({ resolve: { alias: { existing: 'preserved' } }, plugins: [tracer] }, { dev: false, isServer: true, nextRuntime: 'nodejs', webpack: { NormalModuleReplacementPlugin } });
  assert.equal(webpack.resolve.alias.existing, 'preserved');
  assert.deepEqual(tracer.traceIgnores, ['**/data/**', '**/logs/**']);
  if (target === 'cloudflare') {
    assert.ok(config.outputFileTracingIncludes['/*'].length);
    assert.equal(replacements.length, 1);
    assert.ok(replacements[0].pattern.test('@/lib/local-browser'));
    const { chromium } = require(replacements[0].replacement);
    for (const operation of ['launch', 'launchPersistentContext', 'executablePath']) {
      assert.throws(() => chromium[operation](), /requires Mission Control/);
    }
  } else {
    assert.equal(replacements.length, 0);
    assert.equal(config.outputFileTracingIncludes, undefined);
  }
}
console.log('Worker browser boundary and unchanged Mission Control build configuration passed.');
