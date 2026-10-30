import assert from 'node:assert/strict';
import { readFileSync, mkdirSync } from 'node:fs';
import { chromium, expect as baseExpect } from '@playwright/test';
const expect = baseExpect.configure({timeout:30_000});

async function main() {
  const rail = readFileSync('desktop-ui/page-rail.tsx', 'utf8');
  const root = readFileSync('desktop-ui/app/page.tsx', 'utf8');
  const labels = ['Overview','Trends','Payments','Expenses','Accounting','Resale','Recycling'];
  for (const label of labels) assert.ok(rail.includes(`'${label.toLowerCase()}','${label}'`));
  assert.ok(root.includes("['trends', 'Trends']"));
  assert.ok(!root.includes("key === 'overview' && financeView === 'trends'"));
  assert.ok(root.includes("financeView === 'reconciliation' ? 'payments' : financeView"));
  const url = process.env.FINANCE_FIXTURE_URL || 'http://127.0.0.1:4198/tests/capital-hub.html';
  const browser = await chromium.launch({headless:true});
  const errors: string[] = [];
  const timeout = 120_000;
  mkdirSync('tmp/finance-simplify',{recursive:true});
  try {
    for (const width of [1440,390]) for (const theme of ['light','dark']) {
      const page = await browser.newPage({viewport:{width,height:1000},colorScheme:theme as 'light'|'dark'});
      page.setDefaultTimeout(120_000);
      page.on('pageerror',error=>errors.push(error.message));
      await page.goto(url,{timeout});
      await page.evaluate(theme=>{ document.documentElement.setAttribute('data-ops-theme',theme); document.documentElement.classList.toggle('dark',theme==='dark'); },theme);
      const numbers = page.getByRole('region',{name:'Where Do These Numbers Come From?'});
      await expect(numbers).toContainText('$64,500');
      await expect(numbers).toContainText('$1,200');
      await expect(numbers).toContainText('Sep 16');
      await expect(numbers.locator('article')).toHaveCount(3);
      await expect(page.locator('.capital-destinations')).toHaveCount(0);
      await expect(page.locator('#capital-trends')).toHaveCount(0);
      await expect(page.getByRole('tablist',{name:'Finance views'}).getByRole('tab')).toHaveText(labels);
      await page.screenshot({path:`tmp/finance-simplify/overview-${width}-${theme}.png`,fullPage:true,animations:'disabled',timeout:120_000});
      for (const label of labels) {
        await page.getByRole('tab',{name:label,exact:true}).click();
        await expect(page.getByRole('tab',{name:label,exact:true})).toHaveAttribute('aria-selected','true');
        await expect(page.locator('.workspace-rail-link.active')).toHaveAttribute('aria-current','page');
        await expect(page.locator('.workspace-page-list,.workspace-group-toggle')).toHaveCount(0);
        assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth <= innerWidth),`${width}/${theme}/${label} overflow`);
      }
      await page.getByRole('tab',{name:'Payments',exact:true}).click();
      await page.getByRole('button',{name:'Reconcile Yesterday',exact:true}).click();
      await expect(page.getByRole('button',{name:'Reconcile Yesterday',exact:true})).toHaveAttribute('aria-pressed','true');
      await expect(page.getByRole('tab',{name:'Payments',exact:true})).toHaveAttribute('aria-selected','true');
      await expect(page.getByRole('heading',{name:'Payments',exact:true}).first()).toBeVisible();
      await page.getByRole('button',{name:'Recorded Payments',exact:true}).click();
      await page.getByRole('tab',{name:'Overview',exact:true}).click();
      await page.locator('.capital-metric').first().click();
      await expect(page.getByRole('tab',{name:'Trends',exact:true})).toHaveAttribute('aria-selected','true');
      await expect(page.locator('#capital-trends')).toBeVisible();
      await expect(page.locator('.finance-view-trends')).toHaveCount(1);
      await expect(page.locator('.capital-hub')).toHaveCount(0);
      await expect(numbers).toHaveCount(0);
      await expect(page.locator('.capital-day-context')).toHaveCount(0);
      await expect(page.locator('.capital-source-details')).toBeVisible();
      await page.getByRole('tab',{name:'Overview',exact:true}).click();
      await expect(numbers).toBeVisible();
      await expect(page.locator('#capital-trends')).toHaveCount(0);
      await page.goto(url+'?unavailable',{timeout});
      await page.evaluate(theme=>{ document.documentElement.setAttribute('data-ops-theme',theme); document.documentElement.classList.toggle('dark',theme==='dark'); },theme);
      await expect(numbers.getByText('Unavailable',{exact:true})).toHaveCount(3);
      await expect(numbers).not.toContainText('$0');
      await page.screenshot({path:`tmp/finance-simplify/${width}-${theme}.png`,fullPage:true,animations:'disabled',timeout:120_000});
      await page.close();
    }
    assert.deepEqual(errors,[]);
    console.log('Finance simplify: seven tabs and flat workspace links, selection, tile links, payment switch, source strip, unavailable values, desktop/phone light/dark, overflow and page errors passed.');
  } finally {await browser.close();}
}
main().catch(error=>{console.error(error);process.exitCode=1;});
