import { createHash } from 'node:crypto';
import type { Page } from '@playwright/test';
import { customerSearchFields, type CustomerMatch, type CustomerDetails } from '../lib/junkware-customer-contract';
import { clickWithWebFormsCompletion } from './junkware-webforms';

const ROWS = "[id^='ctl00_Content_CustomerLV_'][id$='_ItemRow']";
export function customerRow(cells: string[]): CustomerMatch {
  if (cells.length !== 8) throw new Error('JunkWare customer search columns changed.');
  const [appointmentType, name, company, phone, , email, billingAddress, serviceAddress] = cells;
  return { key: createHash('sha256').update(JSON.stringify(cells)).digest('hex'), appointmentType, name, company, phone, email, billingAddress, serviceAddress: serviceAddress.replace(/\s+select$/i, '') };
}
export async function searchCustomerRows(page: Page, query: string) {
  const fields = customerSearchFields(query);
  for (const [name, value] of Object.entries({ FirstName: fields.firstName, LastName: fields.lastName, Phone1: fields.phone, Email: fields.email })) {
    await page.locator(`#ctl00_Content_${name}TB`).fill(value || '');
  }
  await clickWithWebFormsCompletion(page, '#ctl00_Content_SearchBtn', 'the customer search');
  await page.waitForFunction(() => Boolean(document.querySelector('#ctl00_Content_NewAccountBtn') || document.querySelector("[id^='ctl00_Content_CustomerLV_'][id$='_ItemRow']")), undefined, { timeout: 30000 });
  const rows = page.locator(ROWS);
  const cells = await rows.evaluateAll(nodes => nodes.map(node => [...node.querySelectorAll('td')].map(cell => (cell.textContent || '').replace(/\s+/g, ' ').trim())));
  return cells.map(customerRow);
}
export async function customerResultsHaveMore(page: Page, count: number) {
  if (count > 20) return true;
  const row = page.locator(ROWS).first();
  if (!(await row.count())) return false;
  const tableText = await row.locator('xpath=ancestor::table[1]').innerText();
  return [...tableText.matchAll(/\bof\s+(\d+)\b/gi)].some(match => Number(match[1]) > 1);
}
export function selectedCustomerIndex(matches: CustomerMatch[], key: string) {
  const indexes = matches.flatMap((row, index) => row.key === key ? [index] : []);
  if (indexes.length !== 1) throw new Error('The selected JunkWare customer changed or is ambiguous. Search and select again.');
  return indexes[0];
}
export async function selectCustomerRow(page: Page, matches: CustomerMatch[], key: string): Promise<CustomerDetails> {
  const index = selectedCustomerIndex(matches, key);
  const rowId = await page.locator(ROWS).nth(index).getAttribute('id');
  if (!rowId) throw new Error('The selected JunkWare customer is unavailable.');
  await clickWithWebFormsCompletion(page, `#${rowId}`, 'the existing customer selection');
  // Wait for the customer search to be replaced, not the Save control already on the search screen.
  await page.locator('#ctl00_Content_AppointmentAddressTB').waitFor({ state: 'attached', timeout: 30000 });
  const value = async (name: string) => {
    const field = page.locator(`#ctl00_Content_${name}`);
    return await field.count() ? (await field.inputValue()).trim() : '';
  };
  const business = page.locator('#ctl00_Content_BusinessYesNoRBL_0');
  return {
    firstName: await value('FirstNameTB'), lastName: await value('LastNameTB'), phone: await value('Phone1TB'), email: await value('EmailTB'),
    business: await business.count() ? await business.isChecked() : Boolean(matches[index].company), company: await value('CompanyTB'),
    billingAddress: await value('BillingAddressTB'), billingZip: await value('BillingZipTB'), billingEmail: await value('BillingEmailTB'),
    serviceAddress: await value('AppointmentAddressTB'), serviceZip: await value('AppointmentZipTB'),
    serviceContactName: await value('ServiceContactNameTB'), serviceContactPhone: await value('ServiceContactPhoneTB'),
  };
}
