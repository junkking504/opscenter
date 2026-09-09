import type { Page } from '@playwright/test';
import { closeoutSourceVersion } from '../lib/desktop-closeout-contract';
import { selectWithWebFormsPostback } from './junkware-webforms';

type Source = { status: { value: string; label: string }; [key: string]: unknown };
/** Confirmed appointments omit payment controls. Stage the form, never Save,
 * then reopen and prove the saved record is unchanged before returning options. */
export async function captureCloseoutSource(page: Page, capture: (page: Page) => Promise<Source>): Promise<Source> {
  const before = await capture(page);
  if ((before.paymentMethods as unknown[])?.length || !['1', '8'].includes(before.status.value)) return before;
  if (before.status.value === '8') throw new Error('JunkWare payment controls are unavailable. Reload the appointment before closing it.');
  const url = page.url();
  await selectWithWebFormsPostback(page, '#ctl00_Content_StatusDD', '8', 'the unsaved payment form');
  const staged = await capture(page);
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  const reopened = await capture(page);
  if (closeoutSourceVersion(before) !== closeoutSourceVersion(reopened)) throw new Error('The source appointment changed while loading payment options. Reload and review it.');
  if (!(staged.paymentMethods as unknown[])?.length) throw new Error('JunkWare did not expose payment methods. Open the source appointment to review it.');
  return { ...before, paymentMethods: staged.paymentMethods, payments: staged.payments, balance: staged.balance };
}
