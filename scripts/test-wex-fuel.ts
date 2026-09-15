import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { importWexPostedCsv, parseCsv, parseWexPostedCsv, readWexFuelFinance } from '../lib/wex-fuel';

assert.deepEqual(parseCsv('a,b\n"hello, world","say ""hi"""\n'), [['a', 'b'], ['hello, world', 'say "hi"']]);

const headers = [
  'Transaction Date', 'Transaction Time', 'Post Date', 'Account Number', 'Account Name', 'Card Number', 'Trans ID',
  'Emboss Line 2', 'Custom Vehicle/Asset ID', 'Units', 'Unit of Measure', 'Unit Cost', 'Total Fuel Cost', 'Service Cost',
  'Other Cost', 'Total Non-Fuel Cost', 'Gross Cost', 'Exempt Tax', 'Discount', 'Net Cost', 'Reported Tax', 'Product',
  'Product Description', 'Transaction Description', 'Merchant (Brand)', 'Merchant Name', 'Merchant Address', 'Merchant City',
  'Merchant State / Province', 'Merchant Postal Code', 'Merchant Site ID', 'Prompt 1 Type', 'Prompt 1 Value', 'Prompt 2 Type',
  'Prompt 2 Value', 'Current Odometer', 'Adjusted Odometer', 'Previous Odometer', 'Distance Driven', 'Fuel Economy',
  'Cost Per Distance', 'Vehicle Description', 'VIN', 'Tank Capacity', 'In Service Date', 'Start Odometer', 'Driver Last Name',
  'Driver First Name', 'Driver Middle Name', 'Driver Department', 'Employee ID', 'Transaction Ticket Number', 'Currency Exchange Rate',
  'Rebate Code', 'Driver Prompt ID', 'Vehicle Prompt ID', 'Department',
];
const csv = (rows: string[][]) => [headers, ...rows].map(row => row.map(value => value.includes(',') ? `"${value}"` : value).join(',')).join('\n');
const row = (id: string, date: string, cost: string, merchant = 'Fuel, Market') => headers.map(header => ({
  'Transaction Date': date, 'Transaction Time': '09:00 AM', 'Post Date': '09/14/2026', 'Card Number': '76066',
  'Trans ID': id, 'Emboss Line 2': 'Truck 7', 'Custom Vehicle/Asset ID': 'Truck 7', Units: '19.260',
  'Unit of Measure': 'GA', 'Unit Cost': '3.899', 'Total Fuel Cost': cost, 'Total Non-Fuel Cost': '0', 'Net Cost': cost,
  Product: '001', 'Product Description': 'Unleaded Regular', 'Merchant (Brand)': 'Shell', 'Merchant Name': merchant,
  'Merchant City': 'Mandeville', 'Merchant State / Province': 'LA', 'Merchant Postal Code': '70471', 'Current Odometer': '20345',
  'Driver Last Name': 'McLaughlin', 'Driver First Name': 'Robert', 'Transaction Ticket Number': 'T-1', 'Driver Prompt ID': '2772',
}[header] || ''));

const parsed = parseWexPostedCsv(csv([row('39033526680', '09/13/2026', '75.12'), row('39033526680', '09/13/2026', '75.12')]));
assert.equal(parsed.length, 1, 'identical WEX transaction IDs are idempotent');
assert.equal(parsed[0].driver, 'Robert McLaughlin');
assert.equal(parsed[0].gallons, 19.26);
assert.equal(parsed[0].merchant, 'Fuel, Market');
assert.equal(parsed[0].status, 'posted');

assert.throws(() => parseWexPostedCsv(csv([row('same', '09/13/2026', '75.12'), row('same', '09/13/2026', '80.00')])), /conflicting values/);

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wex-fuel-'));
const source = path.join(root, 'Transactions.csv');
const output = path.join(root, 'snapshot.json');
fs.writeFileSync(source, csv([row('one', '09/13/2026', '75.12'), row('two', '09/12/2026', '69.45')]));
const snapshot = importWexPostedCsv(source, output, new Date('2026-09-15T15:00:00.000Z'));
assert.equal(snapshot.transactionCount, 2);
assert.equal(snapshot.coverageFrom, '2026-09-12');
assert.equal(snapshot.coverageThrough, '2026-09-13');
assert.equal(fs.statSync(output).mode & 0o777, 0o600);
const finance = readWexFuelFinance('2026-09-13', output);
assert.equal(finance.available, true);
assert.deepEqual(finance.selectedDate, { count: 1, gallons: 19.26, netCost: 75.12 });
assert.deepEqual(finance.month, { count: 2, gallons: 38.52, netCost: 144.57 });
assert.equal(finance.transactions[0].transactionId, 'one');
assert.equal(readWexFuelFinance('2026-09-13', path.join(root, 'missing.json')).status, 'missing');
fs.rmSync(root, { recursive: true, force: true });

console.log('WEX fuel import tests passed.');
