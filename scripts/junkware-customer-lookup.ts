import { createHash } from 'node:crypto';
import type { Page } from '@playwright/test';
import { CustomerSelectionError, customerSearchFields, type CustomerMatch, type CustomerDetails } from '../lib/junkware-customer-contract';
import { clickWithWebFormsCompletion, selectWithWebFormsPostback } from './junkware-webforms';

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
/** Repeated history rows are equivalent only after JunkWare proves their identity
 * and all fields we would reuse. Row positions and matching names are not IDs. */
type SelectedSource = { customerId: string; appointmentId: string; customer: CustomerDetails };

function matchingIndexes(matches: CustomerMatch[], key: string) {
  const indexes = matches.flatMap((row, index) => row.key === key ? [index] : []);
  if (!indexes.length) throw new CustomerSelectionError('customer_changed');
  return indexes;
}

export function uniqueCustomerMatches(matches: CustomerMatch[]): CustomerMatch[] {
  return [...new Map(matches.map(match => [match.key, match])).values()];
}

export async function selectCustomerRow(page: Page, matches: CustomerMatch[], key: string, query?: string): Promise<CustomerDetails> {
  const indexes = matchingIndexes(matches, key);
  if (indexes.length === 1) return (await readSelectedCustomer(page, indexes[0], matches[indexes[0]])).customer;
  if (!query || indexes.length > 20) throw new CustomerSelectionError('customer_ambiguous');

  // Resolve history duplicates on separate read-only pages. Leave the caller's
  // current search and franchise intact for the final selection/create flow.
  const url = page.url();
  const franchise = await page.locator('#ctl00_FranchiseDD').inputValue();
  const sources: SelectedSource[] = [];
  for (let ordinal = 0; ordinal < indexes.length; ordinal++) {
    const probe = await page.context().newPage();
    try {
      await probe.goto(url, { waitUntil: 'domcontentloaded' });
      await selectWithWebFormsPostback(probe, '#ctl00_FranchiseDD', franchise, 'the franchise selection');
      const refreshed = await searchCustomerRows(probe, query);
      const refreshedIndexes = matchingIndexes(refreshed, key);
      if (refreshedIndexes.length !== indexes.length) throw new CustomerSelectionError('customer_changed');
      sources.push(await readSelectedCustomer(probe, refreshedIndexes[ordinal], refreshed[refreshedIndexes[ordinal]]));
    } finally { await probe.close(); }
  }
  const first = sources[0];
  if (sources.some(source => !/^[1-9]\d*$/.test(source.customerId) || !/^[1-9]\d*$/.test(source.appointmentId)
    || source.customerId !== first.customerId
    || JSON.stringify(source.customer) !== JSON.stringify(first.customer))
    || new Set(sources.map(source => source.appointmentId)).size !== sources.length) {
    throw new CustomerSelectionError('customer_ambiguous');
  }
  // A reorder/change during the probes must not silently select a different
  // account or contact record from the caller's still-open search page.
  const selected = await readSelectedCustomer(page, indexes[0], matches[indexes[0]]);
  if (selected.customerId !== first.customerId || !sources.some(source => source.appointmentId === selected.appointmentId)
    || JSON.stringify(selected.customer) !== JSON.stringify(first.customer)) {
    throw new CustomerSelectionError('customer_changed');
  }
  return selected.customer;
}

async function readSelectedCustomer(page: Page, index: number, match: CustomerMatch): Promise<SelectedSource> {
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
    customerId: await value('CustomerIDHF'), appointmentId: await value('SelectedAppointmentIDHF'),
    customer: {
      firstName: await value('FirstNameTB'), lastName: await value('LastNameTB'), phone: await value('Phone1TB'), email: await value('EmailTB'),
      business: await business.count() ? await business.isChecked() : Boolean(match.company), company: await value('CompanyTB'),
      billingAddress: await value('BillingAddressTB'), billingZip: await value('BillingZipTB'), billingEmail: await value('BillingEmailTB'),
      serviceAddress: await value('AppointmentAddressTB'), serviceZip: await value('AppointmentZipTB'),
      serviceContactName: await value('ServiceContactNameTB'), serviceContactPhone: await value('ServiceContactPhoneTB'),
    },
  };
}
