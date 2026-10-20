// Measures OpsCenter desktop load and navigation in a real browser.
// Usage: OPS_PERF_BASE_URL=http://127.0.0.1:3000 OPS_PERF_COOKIE='name=value' \
//   node scripts/measure-desktop-performance.mjs [--json out.json]
// The cookie must belong to a local or preview session. Nothing is uploaded.
import { chromium } from 'playwright';
import { writeFileSync } from 'node:fs';

const base = process.env.OPS_PERF_BASE_URL || 'http://127.0.0.1:3000';
const cookie = process.env.OPS_PERF_COOKIE || '';
const runs = Number(process.env.OPS_PERF_RUNS || 3);
const workspaces = (process.env.OPS_PERF_WORKSPACES || 'Command,Schedule,Krewe,Fleet,Finance,Marketing').split(',');
// A typical office connection on a mid-range laptop. Override for other profiles.
const profile = {
  latency: Number(process.env.OPS_PERF_RTT_MS || 40),
  downloadThroughput: Number(process.env.OPS_PERF_DOWN_KBPS || 20_000) * 1024 / 8,
  uploadThroughput: Number(process.env.OPS_PERF_UP_KBPS || 5_000) * 1024 / 8,
  cpu: Number(process.env.OPS_PERF_CPU_SLOWDOWN || 4),
};

// The rail shows user-facing workspace names.
const railLabels = { Schedule: 'Control', Krewe: 'Crew', Fleet: 'Convoy', Finance: 'Capital', Marketing: 'Campaign' };
const median = values => { const sorted = values.filter(Number.isFinite).sort((a, b) => a - b); return sorted.length ? Math.round(sorted[Math.floor(sorted.length / 2)]) : null; };

async function session(browser) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  if (cookie) {
    const [name, ...value] = cookie.split('=');
    await context.addCookies([{ name, value: value.join('='), url: base }]);
  }
  // Map tiles and other third-party requests are outside OpsCenter's budget.
  // OPS_PERF_API_DELAY_MS emulates production read time when measuring against empty data.
  const apiDelay = Number(process.env.OPS_PERF_API_DELAY_MS || 0);
  await context.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (url.origin !== new URL(base).origin) return route.fulfill({ status: 204 });
    if (apiDelay && url.pathname.startsWith('/api/')) await new Promise(resolve => setTimeout(resolve, apiDelay));
    return route.continue();
  });
  const page = await context.newPage();
  const cdp = await context.newCDPSession(page);
  await cdp.send('Network.enable');
  await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: profile.latency, downloadThroughput: profile.downloadThroughput, uploadThroughput: profile.uploadThroughput });
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: profile.cpu });
  return { context, page };
}

async function readyTime(page, workspace) {
  // The desktop app records `opscenter:<workspace>:ready` once records are visible,
  // then clears the measure; observe it as it is created.
  return page.evaluate(name => new Promise(resolve => {
    const observer = new PerformanceObserver(list => {
      const entry = list.getEntries().find(item => item.name === name);
      if (entry) { observer.disconnect(); resolve(entry.startTime + entry.duration); }
    });
    observer.observe({ type: 'measure', buffered: true });
    setTimeout(() => { observer.disconnect(); resolve(null); }, 60_000);
  }), `opscenter:${workspace}:ready`);
}

async function coldLoad(browser, workspace) {
  const { context, page } = await session(browser);
  await page.addInitScript(() => {
    window.__perfMeasures = [];
    const observer = new PerformanceObserver(list => { for (const entry of list.getEntries()) window.__perfMeasures.push({ name: entry.name, end: entry.startTime + entry.duration }); });
    observer.observe({ type: 'measure', buffered: true });
    window.__longTasks = 0;
    new PerformanceObserver(list => { for (const entry of list.getEntries()) window.__longTasks += entry.duration; }).observe({ type: 'longtask', buffered: true });
  });
  await page.goto(`${base}/desktop?data=live&workspace=${encodeURIComponent(workspace)}`, { waitUntil: 'load' });
  await page.waitForFunction(name => window.__perfMeasures.some(entry => entry.name === name), `opscenter:${workspace}:ready`, { timeout: 60_000 }).catch(() => {});
  const result = await page.evaluate(name => {
    const navigation = performance.getEntriesByType('navigation')[0];
    const paint = performance.getEntriesByName('first-contentful-paint')[0];
    const resources = performance.getEntriesByType('resource');
    const scripts = resources.filter(entry => /\.js(\?|$)/.test(entry.name));
    const styles = resources.filter(entry => /\.css(\?|$)/.test(entry.name));
    return {
      documentMs: navigation.responseStart,
      firstPaintMs: paint?.startTime ?? null,
      domReadyMs: navigation.domContentLoadedEventEnd,
      loadMs: navigation.loadEventEnd,
      readyMs: window.__perfMeasures.find(entry => entry.name === name)?.end ?? null,
      longTaskMs: window.__longTasks,
      jsKb: scripts.reduce((sum, entry) => sum + entry.encodedBodySize, 0) / 1024,
      cssKb: styles.reduce((sum, entry) => sum + entry.encodedBodySize, 0) / 1024,
    };
  }, `opscenter:${workspace}:ready`);
  await context.close();
  return result;
}

async function warmNavigation(browser) {
  const { context, page } = await session(browser);
  await page.goto(`${base}/desktop?data=live&workspace=Command`, { waitUntil: 'load' });
  await readyTime(page, 'Command');
  const timings = {};
  for (const workspace of workspaces.filter(name => name !== 'Command')) {
    const button = page.locator(`nav.page-rail section[aria-label="${railLabels[workspace] || workspace}"] a`).first();
    if (!await button.count()) { timings[workspace] = null; continue; }
    const ready = readyTime(page, workspace);
    const started = await page.evaluate(() => performance.now());
    await button.click();
    const end = await ready;
    timings[workspace] = end == null ? null : end - started;
  }
  await context.close();
  return timings;
}

const browser = await chromium.launch({ headless: true, executablePath: process.env.OPS_PERF_CHROMIUM || undefined });
const report = { base, profile, runs, cold: {}, warm: {} };
for (const workspace of workspaces) {
  const samples = [];
  for (let index = 0; index < runs; index++) samples.push(await coldLoad(browser, workspace));
  report.cold[workspace] = Object.fromEntries(Object.keys(samples[0]).map(key => [key, median(samples.map(sample => sample[key]))]));
}
const warmSamples = [];
for (let index = 0; index < runs; index++) warmSamples.push(await warmNavigation(browser));
for (const workspace of Object.keys(warmSamples[0])) report.warm[workspace] = median(warmSamples.map(sample => sample[workspace]));
await browser.close();

console.table(report.cold);
console.table(report.warm);
const output = process.argv.indexOf('--json');
if (output > 0) writeFileSync(process.argv[output + 1], JSON.stringify(report, null, 2));
