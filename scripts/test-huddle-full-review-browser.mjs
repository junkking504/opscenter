import { chromium, webkit } from 'playwright';
import assert from 'node:assert/strict';
import path from 'node:path';
const browser = await (process.env.HUDDLE_BROWSER === 'webkit' ? webkit : chromium).launch({headless:true});
const page = await browser.newPage({viewport:{width:1920,height:1080}, reducedMotion:'reduce'});
const errors=[];
page.on('pageerror',error=>errors.push(error.message));
async function assertFullReview() {
  const quote = page.locator('.tv-card-review > p');
  const geometry = await quote.evaluate(p => {
    const style = getComputedStyle(p), box = p.getBoundingClientRect();
    const range = document.createRange(); range.selectNodeContents(p);
    const text = range.getBoundingClientRect();
    return { clamp: style.webkitLineClamp, overflow: style.overflow, textBottom: text.bottom,
      bottom: box.bottom, authorTop: p.nextElementSibling.getBoundingClientRect().top,
      footerTop: p.closest('section').querySelector('footer').getBoundingClientRect().top,
      articleBottom: p.closest('article').getBoundingClientRect().bottom };
  });
  assert.equal(geometry.clamp, 'none');
  assert.equal(geometry.overflow, 'visible');
  assert.ok(geometry.textBottom <= geometry.bottom + 1, 'Entire quote fits its paragraph');
  assert.ok(geometry.bottom <= geometry.authorTop + 1, 'Quote does not overlap author');
  assert.ok(geometry.articleBottom <= geometry.footerTop + 1, 'Card does not overlap source footer');
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'No horizontal overflow');
}

try {
  await page.route('**/*',route=>new URL(route.request().url()).hostname==='127.0.0.1'?route.continue():route.fulfill({status:204}));
  const origin=process.env.DESKTOP_TEST_ORIGIN || 'http://127.0.0.1:3158';
  await page.goto(`${origin}/tests/aspect-ratio.html?tv=1`);
  await page.waitForSelector('.tv-card-review > p');
  await assertFullReview();
  const review='I give the team 5 stars for exceptional service. The crew was very professional. They removed a refrigerator from my backyard and carefully cleaned the area before leaving.';
  await page.locator('.tv-card-review > p').evaluate((p,text)=>{p.textContent=text;},review);
  await assertFullReview();
  assert.ok(await page.evaluate(()=>document.documentElement.scrollHeight<=innerHeight),'Ordinary full review fits the wall display');
  if(process.env.HUDDLE_EVIDENCE_DIR) await page.screenshot({path:path.join(process.env.HUDDLE_EVIDENCE_DIR,'review-desktop.png'),fullPage:true});
  const longReview='The team arrived on time and carefully removed everything we requested. '.repeat(20)+'\n\nThis is the complete ending of the review.';
  for(const [width,height] of [[1920,1080],[1440,900],[1280,900],[390,844]]) {
    await page.setViewportSize({width,height});
    await page.locator('.tv-card-review > p').evaluate((p,text)=>{p.textContent=text;},longReview);
    assert.equal(await page.locator('.tv-card-review > p').textContent(),longReview);
    await assertFullReview();
    if(process.env.HUDDLE_EVIDENCE_DIR && width===390) await page.screenshot({path:path.join(process.env.HUDDLE_EVIDENCE_DIR,'review-phone.png'),fullPage:true});
  }
  for(const [width,height] of [[1920,1080],[390,844]]) {
    await page.setViewportSize({width,height});
    await page.goto(`${origin}/tests/aspect-ratio.html?workspace=Command`);
    await page.waitForSelector('.command-revenue-hero');
    if(process.env.HUDDLE_EVIDENCE_DIR) await page.screenshot({path:path.join(process.env.HUDDLE_EVIDENCE_DIR,`command-${width}.png`),fullPage:true});
  }
  assert.deepEqual(errors,[]);
  console.log('Full review text and attribution stay visible without overlap at 1920, 1440, 1280 and 390px. Ordinary review fits 1080p.');
} finally { await browser.close(); }
