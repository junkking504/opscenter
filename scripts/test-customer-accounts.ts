import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { desktopCustomerHref } from '../desktop-ui/lib/desktop-links';
import assert from 'node:assert/strict';
import { customerDirectory, customerAccount, readCustomers } from '../lib/customer-accounts';
import { historySource } from '../lib/customer-history';
const source = (id:string, extra:Record<string,unknown>={}) => historySource({appt_id:id,customer_name:'Synthetic Account',phone:'5045550123',appointment_date:'2026-10-20',appointment_type:'Job',...extra},'2026-10-20','2026-10-20T12:00:00Z')!;
const rows=[source('1'),source('2',{appointment_date:'2026-09-01'}),source('3',{phone:'5045550124'}),source('4',{customer_name:'Different Person'}),source('5',{phone:''}),source('6',{phone:'',customerEmail:'test@example.com'}),source('7',{phone:'',customerEmail:'test@example.com'}),source('8',{phone:'',source_estimate_appointment_id:'1',customer_name:'Former Contact'})];
assert.equal(customerDirectory(rows).total,6);
assert.equal(customerDirectory(rows,'(504) 555-0123').total,2,'shared phone with different names remains separate');
assert.equal(customerDirectory(rows,'test@example.com').customers[0].appointments,2);
assert.equal(customerDirectory(rows,'not-present').total,0);
assert.deepEqual(customerAccount(rows,'1')!.records.map(r=>r.id).sort(),['1','2','8']);
assert.equal(customerAccount(rows,'1')!.customer.name,'Synthetic Account','different linked contact never replaces profile');
assert.equal(customerAccount(rows,'404'),null);
const bridged=[source('1',{customerEmail:'a@example.com'}),source('2',{customerEmail:'b@example.com'}),source('3',{phone:'5045550999',customerEmail:'b@example.com'})];
assert.deepEqual(customerAccount(bridged,'1')!.records.map(r=>r.id).sort(),['1','2'],'no transitive contact merging');
const many=Array.from({length:123},(_,i)=>source(String(i+100)));
assert.equal(customerAccount(many,'100')!.records.length,50);
assert.equal(customerAccount(many,'100',100)!.records.length,23);
assert.equal(customerAccount(many,'100')!.total,123);
const separate=Array.from({length:123},(_,i)=>source(String(i+100),{phone:'',customer_name:`Synthetic ${i}`}));
assert.equal(customerDirectory(separate,'',100).customers.length,23);
const detail=source('99',{closeout:{loadQuantity:'2',loadSize:'3 (1/2)',loadPrice:'$400',bedloadSize:'1/4',bedloadPrice:'$50',otherCharges:[{name:'Labor',quantity:'2',unitPrice:'$25',total:'$50'}],total:'$500',tip:'',payments:[{method:'Billed',amount:'$500'}]}});
assert.deepEqual(detail.volumes,['Load: 2 × 3 (1/2)','Bedload: 1/4']);
assert.deepEqual(detail.prices,['Load total $400.00','Bedload total $50.00','Labor · 2 × $25.00 = $50.00']);
assert.ok(detail.amounts.includes('Billed $500.00 · Billed'));
const old=source('90',{revenue:'$600.00',payment_type:'Billed'});
assert.deepEqual(old.amounts,['Recorded revenue $600.00','Payment detail unavailable · source method: Billed']);
assert.deepEqual(old.volumes,[]);
const pending=source('91',{closeout_refresh_pending:true,revenue:'600',closeout:{loadSize:'1/2',loadPrice:'600',total:'600'}});
assert.deepEqual(pending.amounts,['Payment updating']);assert.deepEqual(pending.prices,[]);assert.deepEqual(pending.volumes,[]);
const account=customerAccount([detail],detail.id)!;
assert.equal('phone' in account.records[0],false,'matching keys stay out of history records');
assert.equal('estimateId' in account.records[0],false);
console.log('Customer accounts PASS: conservative identity, no transitive joins, linked contacts, complete pagination, search, volume/price source fields, legacy revenue and pending detail.');

for (const extra of [{revenue:0}, {revenue:'0',final_status:'Cancelled'}, {revenue:'100',appointment_type:'Estimate'}]) assert.deepEqual(source('92',extra).amounts,[], 'default revenue and estimate revenue are not quotes or payments');
assert.deepEqual(source('92',{revenue:'100',final_status:'Cancelled'}).amounts,['Recorded revenue $100.00','Payment detail unavailable']);
const overlap=[source('1',{customerEmail:'same@example.com'}),source('2'),source('3',{phone:'',customerEmail:'same@example.com'}),source('4',{phone:'',customerEmail:'same@example.com'})];
for (const item of customerDirectory(overlap).customers) assert.equal(item.appointments, customerAccount(overlap,item.id)!.total);
assert.deepEqual(source('95',{closeout:{otherCharges:[{total:'25'}],discount:'-10'}}).prices,['Additional charge = $25.00','Discount field (source) -$10.00']);

assert.equal(new URL(desktopCustomerHref('100','2026-11-01'),'https://example.com').searchParams.get('date'),'2026-11-01');
assert.equal(new URL(desktopCustomerHref('../100'),'https://example.com').searchParams.has('customer'),false);
async function verifyViewedDate() {
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'customer-account-date-'));
  try {
    const history=path.join(directory,'history/junkware');fs.mkdirSync(history,{recursive:true});
    fs.writeFileSync(path.join(history,'junkware_2026-10-20_raw.json'),JSON.stringify({scraped_at:'2026-10-20T12:00:00Z',appointments:[{appt_id:'1',appointment_date:'2026-10-20',customer_name:'Synthetic Future',phone:'5045550123'}]}));
    fs.writeFileSync(path.join(history,'junkware_schedule_fast_2027-01-05.json'),JSON.stringify({date:'2027-01-05',scraped_at:'2026-10-21T12:00:00Z',markets_scraped:['Junk King New Orleans','Junk King Northshore','Junk King Baton Rouge','Junk King Jefferson Parish'],appointments:[{appt_id:'2',appointment_date:'2027-01-05',customer_name:'Synthetic Future',phone:'5045550123',appointment_type:'Job'}],cancelled:[]}));
    const result=await readCustomers('',0,'2',directory,'2027-01-05');
    assert.ok(result && 'records' in result);assert.equal(result.total,2);
  } finally { fs.rmSync(directory,{recursive:true,force:true}); }
}
verifyViewedDate().then(()=>console.log('Viewed-date customer anchor PASS.')).catch(error=>{console.error(error);process.exitCode=1;});
