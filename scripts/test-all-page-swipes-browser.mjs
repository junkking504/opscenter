import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from '../desktop-ui/node_modules/vite/dist/node/index.js';
import { chromium } from 'playwright';

// The full shell and supplied office page keys, backed only by synthetic
// fixtures. Native touch is dispatched through Chromium, not React handlers.
const root = fileURLToPath(new URL('../', import.meta.url));
const cache = fs.mkdtempSync(path.join(os.tmpdir(), 'all-page-swipes-'));
const groups = [
  ['Command', 'commandView', ['now', 'today', 'monitor', 'forecast']],
  ['Schedule', 'scheduleView', ['board', 'calendar', 'customers', 'estimates', 'followup', 'history']],
  ['Krewe', 'kreweView', ['today', 'callin', 'payperiod', 'monthly']],
  ['Fleet', 'fleetView', ['overview', 'maintenance', 'service', 'scores', 'reports']],
  ['Finance', 'financeView', ['overview', 'payments', 'expenses', 'accounting', 'resale', 'recycling', 'reconciliation', 'trends']],
  ['Marketing', 'marketingView', ['overview', 'leads', 'reviews', 'performance']],
  ['Settings', 'settingsView', ['overview']],
];
const order = groups.map(([workspace]) => workspace);
const cases = groups.flatMap(([workspace, key, pages]) => pages.map(view => ({ workspace, key, view }))).filter(item=>!process.env.ALL_PAGE_SWIPE_CASE || `${item.workspace}/${item.view}`===process.env.ALL_PAGE_SWIPE_CASE);
const baseline = process.env.SWIPE_AUDIT_BASELINE === '1';
const report = { cases: [], errors: [], blockedExternal: [], limitations: ['Synthetic source fixtures are incomplete for some record-specific views; shell navigation is exercised on every page key.', 'Physical iPhone/Safari touch is not established by Chromium CDP.', 'The separate Huddle/TV view is outside this workspace-key matrix.'] };
const server = await createServer({ configFile: path.join(root, 'desktop-ui/tests/dashboard-hierarchy.vite.config.ts'), configLoader: 'runner', cacheDir: cache, server: { host: '127.0.0.1', port: Number(process.env.ALL_PAGE_SWIPE_PORT || 3198), strictPort: true } });
let browser;
try {
  await server.listen();
  const launch = { headless: true };
  if (process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE) launch.executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE;
  else if (fs.existsSync('/usr/bin/chromium')) launch.executablePath = '/usr/bin/chromium';
  browser = await chromium.launch(launch);
  const origin = `http://127.0.0.1:${server.httpServer.address().port}`;
  for (const variant of [{ width: 375, theme: 'light' }, { width: 430, theme: 'dark' }]) {
    const page = await browser.newPage({ viewport: { width: variant.width, height: 844 }, hasTouch: true, isMobile: true, reducedMotion: 'no-preference' });
    page.on('pageerror', error => report.errors.push(error.message));
    await page.route('**/*', route => {
      const url = new URL(route.request().url());
      if (url.origin === origin) return route.continue();
      report.blockedExternal.push(url.origin); return route.abort();
    });
    await page.addInitScript(theme => {
      localStorage.setItem('opscenter.theme.v1', theme);
      window.allPageSwipeWrites = [];
      window.allPageSwipeMockedReads = [];
      window.allPageSwipeTarget = null;window.allPageSwipeEvents=[];
      for(const type of ['scroll','touchstart','touchmove','touchend','touchcancel'])window.addEventListener(type,event=>window.allPageSwipeEvents.push({type,at:performance.now(),x:event.touches?.[0]?.clientX,y:event.touches?.[0]?.clientY}),{capture:true,passive:true});
      window.addEventListener('touchstart',event=>{
        const node=event.target;
        const ancestry=[];for(let el=node;el instanceof Element;el=el.parentElement)ancestry.push({tag:el.tagName,className:el.className,width:el.clientWidth,scrollWidth:el.scrollWidth,overflowX:getComputedStyle(el).overflowX});
        window.allPageSwipeTarget={ancestry,at:performance.now(),tag:node?.tagName,safe:node instanceof Element&&!node.closest('a,button,input,select,textarea,svg,[data-gesture-ignore]')};
      },{capture:true,passive:true});
      let implementation = window.fetch.bind(window);
      // Fixtures replace fetch after this script. Keep the write boundary around
      // every replacement, and fail the audit if navigation attempts a write.
      Object.defineProperty(window, 'fetch', {
        configurable: true,
        get: () => async (input, init) => {
          const method = init?.method || (input instanceof Request ? input.method : 'GET');
          if (!['GET', 'HEAD'].includes(method.toUpperCase())) {
            // Existing accounting reads use POST; satisfy this exact read mode
            // in-memory without invoking its provider or fixture fetch handler.
            const url=new URL(input instanceof Request?input.url:String(input),location.origin);
            let body;try{body=JSON.parse(init?.body || 'null');}catch{}
            if(method.toUpperCase()==='POST'&&url.pathname==='/api/desktop/accounting'&&body?.mode==='list'){
              window.allPageSwipeMockedReads.push({path:url.pathname,mode:'list'});
              return Response.json({data:{rows:[],total:0,observedAt:'2026-10-09T12:00:00Z',options:{groups:[],methods:[],statuses:[]},verifications:{},pending:[]}});
            }
            window.allPageSwipeWrites.push(String(input));
            throw new Error('Operational writes forbidden in all-page swipe audit');
          }
          return implementation(input, init);
        },
        set: value => { implementation = value; },
      });
    }, variant.theme);
    const cdp = await page.context().newCDPSession(page);
    for (const current of cases) {
      const url = new URL('/desktop-assets/tests/css-phase-two.html', origin);
      url.search = new URLSearchParams({ workspace: current.workspace, [current.key]: current.view, date: '2026-10-09', analyticsCases: '1', commandCases: '1', sourceCases: '1' }).toString();
      await page.goto(url.href);
      await page.getByLabel('Choose workspace').waitFor();
      // Lazy chart modules can change page geometry after shell paint. A scroll
      // during touch correctly cancels navigation; start this audit after load.
      await page.waitForLoadState('networkidle');
      assert.equal(await page.getByLabel('Choose workspace').inputValue(), current.workspace);
      assert.equal(await page.locator('html').getAttribute('data-ops-theme'), variant.theme);
      // The visible non-control footer is a consistent safe surface even when
      // this fixture deliberately returns unavailable records in a subview.
      const footer = page.locator('.command-footer > span');
      await footer.scrollIntoViewIfNeeded();
      await page.waitForTimeout(80);
      const box = await footer.boundingBox();
      assert.ok(box && box.height > 0, `${current.workspace}/${current.view} safe surface`);
      const direction = current.workspace === 'Settings' ? -1 : 1;
      // Chromium adjusts touch targets near controls. Use the span center,
      // well away from the adjacent Source Health button, not its inner edge.
      const start = box.x + box.width / 2;
      const end = start - direction * 90;
      const y = box.y + Math.min(12, box.height / 2);
      const target = await page.evaluate(({ x, y }) => {
        const node = document.elementFromPoint(x, y);
        return { tag: node?.tagName, text: node?.textContent?.slice(0, 80), safe: !!node && !node.closest('a,button,input,select,textarea,svg,[data-gesture-ignore]') };
      }, { x: start, y });
      assert.ok(target.safe, `Actual hit target must be safe: ${JSON.stringify({current,box,start,y,target})}`);
      const historyBefore = await page.evaluate(() => history.length);
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: start, y }] });
      assert.equal(await page.evaluate(()=>window.allPageSwipeTarget?.safe),true,'Browser-adjusted native touch target is safe');
      for (let step = 1; step <= 5; step++) {
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: start + (end - start) * step / 5, y }] });
        await page.waitForTimeout(18);
      }
      assert.equal(await page.getByLabel('Choose workspace').inputValue(), current.workspace, 'Navigation must wait for release');
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      const expected = order[order.indexOf(current.workspace) + direction];
      let passed = true;
      try { await page.waitForFunction(value => document.querySelector('[aria-label="Choose workspace"]')?.value === value, expected, { timeout: 4000 }); }
      catch { passed = false; }
      const selected = await page.getByLabel('Choose workspace').inputValue();
      const diagnostics=passed?undefined:await page.evaluate(()=>({events:window.allPageSwipeEvents,target:window.allPageSwipeTarget,scale:visualViewport.scale,selected:String(getSelection()),focus:document.activeElement?.tagName,modal:[...document.querySelectorAll('dialog[open],[role=dialog],[aria-modal=true],.record-drawer,.drawer-backdrop')].filter(el=>el.getClientRects().length&&!el.closest('[hidden],[inert]')).map(el=>el.className)}));
      const detail = { diagnostics, ...current, ...variant, expected, selected, passed, mockedReadPosts:await page.evaluate(()=>window.allPageSwipeMockedReads) };
      report.cases.push(detail);
      assert.deepEqual(await page.evaluate(() => window.allPageSwipeWrites), [], 'No operational write attempted');
      if (!baseline) assert.ok(passed, `Workspace swipe failed: ${JSON.stringify(detail)}`);
      if (passed) {
        if (process.env.ALL_PAGE_SWIPE_SCREENSHOTS && current.view === groups.find(([workspace]) => workspace === current.workspace)[2][0]) {
          fs.mkdirSync(process.env.ALL_PAGE_SWIPE_SCREENSHOTS, {recursive:true});
          await page.screenshot({path:path.join(process.env.ALL_PAGE_SWIPE_SCREENSHOTS, `${variant.width}-${variant.theme}-${current.workspace}-to-${expected}.png`)});
        }
        assert.equal(await page.evaluate(() => history.length), historyBefore, 'Navigation preserves replaceState history semantics');
        assert.equal(new URL(page.url()).searchParams.get('date'), '2026-10-09', 'Operating date stays unchanged');
        assert.equal(await page.locator('.workspace-heading h1').evaluate(el => document.activeElement === el), true, 'Swipe moves focus to destination heading');
      }
    }
    // Sources is a modal, not another workspace. It must block navigation.
    await page.goto(`${origin}/desktop-assets/tests/css-phase-two.html?workspace=Settings&date=2026-10-09&sourceCases=1`);
    await page.getByRole('button', { name: 'View source details', exact: true }).click();
    await page.getByRole('dialog', { name: 'Source Health' }).waitFor();
    await page.locator('.workspace').evaluate(el => {
      const dispatch = (type, x) => { const point = new Touch({ identifier: 0, target: el, clientX: x, clientY: 250 }); el.dispatchEvent(new TouchEvent(type, { bubbles: true, touches: type === 'touchend' ? [] : [point], changedTouches: [point] })); };
      dispatch('touchstart', 100); dispatch('touchmove', 240); dispatch('touchend', 240);
    });
    assert.equal(await page.getByLabel('Choose workspace').inputValue(), 'Settings', 'Source modal blocks background swipe');
    await page.close();
  }
  if (process.env.ALL_PAGE_SWIPE_EVIDENCE) fs.writeFileSync(process.env.ALL_PAGE_SWIPE_EVIDENCE, JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({ cases: report.cases.length, passed: report.cases.filter(row => row.passed).length, failures: report.cases.filter(row => !row.passed), errors: [...new Set(report.errors)], externalRequestsBlocked: [...new Set(report.blockedExternal)], limitations: report.limitations }, null, 2));
  assert.deepEqual(report.errors, [], 'No uncaught runtime errors');
} finally {
  await browser?.close(); await server.close(); fs.rmSync(cache, { recursive: true, force: true });
}
