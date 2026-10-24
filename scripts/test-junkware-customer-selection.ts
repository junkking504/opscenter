import assert from 'node:assert/strict';
import http from 'node:http';
import { chromium } from '@playwright/test';
import { searchCustomerRows, selectCustomerRow, uniqueCustomerMatches } from './junkware-customer-lookup';
import { selectWithWebFormsPostback } from './junkware-webforms';

type Source = { customerId: string; appointmentId: string; street?: string; billingEmail?: string; type?: string };
type Scenario = {
  records: Source[];
  refresh?: (search: number, records: Source[]) => Source[];
  finalChange?: Partial<Source>;
};
async function main() {
const original: Source[] = [101, 102, 103].map(id => ({ customerId: '42', appointmentId: String(id) }));
let scenario: Scenario;
let searches = 0;
let nextSnapshot = 0;
let selections = 0;
let saves = 0;
const snapshots = new Map<string, { records: Source[]; first: boolean }>();
const selectedFranchises: string[] = [];
const escape = (value: string) => value.replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;');
const field = (name: string, value = '', type = 'text') => `<input id="ctl00_Content_${name}" name="ctl00$Content$${name}" type="${type}" value="${escape(value)}">`;
function form(franchise: string, contents: string, snapshot = '') {
  return `<html><body><form method="post">
    <input type="hidden" name="__EVENTTARGET"><input type="hidden" name="__EVENTARGUMENT">
    <input type="hidden" name="snapshot" value="${snapshot}">
    <select id="ctl00_FranchiseDD" name="ctl00$FranchiseDD"><option value="north" ${franchise === 'north' ? 'selected' : ''}>North</option><option value="south" ${franchise === 'south' ? 'selected' : ''}>South</option></select>
    ${contents}<button id="ctl00_Content_SaveAppointmentBtn" name="save">Save</button></form>
    <script>function __doPostBack(target,arg){document.querySelector('[name="__EVENTTARGET"]').value=target;document.querySelector('[name="__EVENTARGUMENT"]').value=arg;document.forms[0].submit();}</script>
    </body></html>`;
}
function searchForm(franchise: string, records?: Source[], snapshot?: string) {
  return form(franchise, ['FirstName','LastName','Phone1','Email'].map(name => field(name + 'TB')).join('')
    + '<button id="ctl00_Content_SearchBtn" name="ctl00$Content$SearchBtn">Search</button><button id="ctl00_Content_NewAccountBtn" name="new">New</button>'
    + (records ? '<table>' + records.map((record, index) => {
      const target = `ctl00$Content$CustomerLV$ctrl${index}$SelectBtn`;
      const cells = [record.type || 'Job', 'Synthetic Customer', '', '(504) 555-0100', '', 'synthetic@example.invalid', '100 Example St', record.street || '100 Example St'];
      return `<tr id="ctl00_Content_CustomerLV_ctrl${index}_ItemRow" onclick="__doPostBack('${target}','')">` + cells.map((cell, column) => `<td>${cell}${column === 7 ? ' Select' : ''}</td>`).join('') + '</tr>';
    }).join('') + '</table>' : ''), snapshot);
}
function selectedForm(franchise: string, record: Source) {
  return form(franchise, Object.entries({
    FirstNameTB: 'Synthetic', LastNameTB: 'Customer', Phone1TB: '(504) 555-0100', EmailTB: 'synthetic@example.invalid', CompanyTB: '',
    BillingAddressTB: '100 Example St', BillingZipTB: '70000', BillingEmailTB: record.billingEmail || '',
    AppointmentAddressTB: record.street || '100 Example St', AppointmentZipTB: '70000', ServiceContactNameTB: '', ServiceContactPhoneTB: '',
  }).map(([name, value]) => field(name, value)).join('') + field('CustomerIDHF', record.customerId, 'hidden')
    + field('SelectedAppointmentIDHF', record.appointmentId, 'hidden') + field('BusinessYesNoRBL_0', '', 'radio'));
}
const server = http.createServer(async (request, response) => {
  let body = '';
  for await (const chunk of request) body += chunk;
  const data = new URLSearchParams(body);
  const franchise = data.get('ctl00$FranchiseDD') || 'north';
  const target = data.get('__EVENTTARGET') || '';
  let html = searchForm(franchise);
  if (data.has('save') || data.has('new')) { saves++; response.writeHead(400).end('Forbidden in fixture'); return; }
  if (data.has('ctl00$Content$SearchBtn')) {
    searches++;
    const records = scenario.refresh?.(searches, scenario.records) || scenario.records;
    const id = String(++nextSnapshot);
    snapshots.set(id, { records: records.map(record => ({ ...record })), first: searches === 1 });
    html = searchForm(franchise, records, id);
  } else if (target.includes('$CustomerLV$')) {
    const index = Number(target.match(/ctrl(\d+)\$SelectBtn/)?.[1]);
    const snapshot = snapshots.get(data.get('snapshot') || '');
    assert.ok(snapshot && snapshot.records[index], 'fixture source selection must exist');
    const record = { ...snapshot.records[index], ...(snapshot.first ? scenario.finalChange : {}) };
    selections++;
    selectedFranchises.push(franchise);
    html = selectedForm(franchise, record);
  }
  response.writeHead(200, { 'Content-Type': 'text/html' }).end(html);
});
await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
const address = server.address();
assert.ok(address && typeof address !== 'string');
const url = `http://127.0.0.1:${address.port}/new-appointment.aspx`;
const browser = await chromium.launch({ headless: true });
async function check(name: string, fixture: Scenario, expected?: RegExp) {
  scenario = fixture; searches = 0; selections = 0; saves = 0; snapshots.clear(); selectedFranchises.length = 0;
  const context = await browser.newContext();
  const page = await context.newPage();
  try {
    await page.goto(url);
    await selectWithWebFormsPostback(page, '#ctl00_FranchiseDD', 'south', 'the franchise selection');
    const matches = await searchCustomerRows(page, 'Synthetic Customer');
    const key = matches[0].key;
    const action = () => selectCustomerRow(page, matches, key, 'Synthetic Customer');
    if (expected) await assert.rejects(action, expected);
    else {
      const customer = await action();
      assert.equal(customer.firstName, 'Synthetic');
      assert.equal(customer.serviceAddress, '100 Example St');
      assert.equal(await page.locator('#ctl00_FranchiseDD').inputValue(), 'south');
    }
    assert.equal(context.pages().length, 1, 'all probe pages close on success and failure');
    assert.ok(selectedFranchises.every(value => value === 'south'), 'preserve the chosen franchise on every probe');
    assert.equal(saves, 0, 'lookup never saves a booking or creates an account');
    console.log(`PASS ${name}`);
    return { matches, selections, searches };
  } finally { await context.close(); }
}
try {
  const repeated = await check('same customer, three history records', { records: original });
  assert.equal(repeated.selections, 4, 'verify all three identities, then select on the original form');
  assert.equal(uniqueCustomerMatches(repeated.matches).length, 1, 'one result/button for identical display fingerprints');
  const unique = await check('single record keeps fast selection path', { records: original.slice(0, 1) });
  assert.equal(unique.searches, 1); assert.equal(unique.selections, 1);
  await check('different customer IDs remain ambiguous', { records: [original[0], { ...original[1], customerId: '99' }] }, /ambiguous/);
  await check('matching ID but different saved billing detail remains ambiguous', { records: [original[0], { ...original[1], billingEmail: 'other@example.invalid' }] }, /ambiguous/);
  await check('missing source customer ID fails closed', { records: original.map(record => ({ ...record, customerId: '' })) }, /ambiguous/);
  await check('zero source IDs fail closed', { records: original.map(record => ({ ...record, customerId: '0' })) }, /ambiguous/);
  await check('bounded probe limit fails closed', { records: Array.from({length:21}, (_,index)=>({...original[0],appointmentId:String(100+index)})) }, /ambiguous/);
  await check('missing source history ID fails closed', { records: original.map(record => ({ ...record, appointmentId: '' })) }, /ambiguous/);
  await check('record removed after refresh fails closed', { records: original, refresh: (count, records) => count > 1 ? records.slice(0, 2) : records }, /changed/);
  await check('details changed after refresh require new search', { records: original, refresh: (count, records) => count > 1 ? records.map(record => ({ ...record, street: '200 Changed St' })) : records }, /changed/);
  await check('stable reordered history records can still resolve', { records: original, refresh: (count, records) => count > 1 ? [...records].reverse() : records });
  await check('unstable ordering cannot count the same source twice', { records: original, refresh: (count, records) => count === 3 ? [records[1], records[0], records[2]] : records }, /ambiguous/);
  await check('final source identity changes fail closed', { records: original, finalChange: { customerId: '99' } }, /changed/);
  await check('final saved fields change fails closed', { records: original, finalChange: { billingEmail: 'changed@example.invalid' } }, /changed/);
  await check('fresh search recovers after source change', { records: original });
  console.log('Synthetic customer selection regression suite passed.');
} finally {
  await browser.close();
  await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
}

}
main().catch(error => { console.error(error); process.exitCode = 1; });
