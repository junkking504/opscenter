import assert from 'node:assert/strict';
import { desktopPayments } from '../lib/desktop-payments';
import type { PaymentReconciliationView } from '../lib/payment-reconciliation';
const date = '2026-09-06';
const card = {date,jkNumber:'JK4000001',customer:'Example',paymentMethod:'Credit Card',paidAmount:110,revenueAmount:100,tipAmount:10,qboTransactionId:'qbo-example',qboStatus:'posted',reconciliation:'Matched'};
const base = {status:'balanced',summary:{junkware_count:1,junkware_total:110,merchant_center_total:110,matched_count:1,net_difference:0,exception_count:0},paymentsByJob:[card],exceptions:[],merchantCenterAvailable:true,merchantCenterFresh:true} as unknown as PaymentReconciliationView;
const job = (id:string,method:string,paid:string,detail='') => ({appt_id:id,job_id:`JK400000${id}`,appointment_date:date,customer_name:'Example',truck:'Truck 3',revenue:paid,closeout:{tip:'',payments:[{method,amount:paid,detail}]}});
const cash=job('2','Cash','$100.00'),check=job('3','Check','$268.00','#00360');
const result=desktopPayments(date,base,[job('1','Credit Card','$110.00','***1234'),cash,check,{...check}]);
assert.equal(result.paymentsByJob.length,3,'Schedule copies must not duplicate tenders');
assert.deepEqual(result.recordedPayments,{total:478,cash:100,check:268});
assert.equal(result.summary.junkware_total,110,'Card ledger totals stay card-only');
assert.equal(result.summary.net_difference,0,'Cash and checks do not create card exceptions');
assert.equal(result.paymentsByJob.find(row=>row.tender==='check')?.checkNumber,'00360','Preserve leading zeroes');
for (const row of result.paymentsByJob.filter(row=>row.tender!=='card')) {
 assert.equal(row.reconciliation,'Recorded');assert.equal(row.qboTransactionId,null);assert.equal(row.jobDifference,0);assert.equal(row.truck,'Truck 3');
}
const split={...job('4','Cash','$40'),revenue:'$100',closeout:{tip:'$10',payments:[{method:'Cash',amount:'$40'},{method:'Check',amount:'$70',detail:'Check #72'}]}};
const splitResult=desktopPayments(date,{...base,paymentsByJob:[]},[split]).paymentsByJob;
assert.equal(splitResult.length,2);assert.ok(splitResult.every(row=>row.jobDifference===0 && row.tipAmount===null),'Do not allocate the entire job tip to each split tender');
assert.equal(splitResult[1].checkNumber,'72');
const duplicateTender={...cash,closeout:{payments:[{method:'Cash',amount:50},{method:'Cash',amount:50}]}};
assert.equal(desktopPayments(date,base,[duplicateTender]).paymentsByJob.length,3,'Keep genuinely separate same-value tenders');
const absent=desktopPayments(date,{...base,status:'not_collected',paymentsByJob:[]},[cash,job('5','Check','$10')]);
assert.equal(absent.recordedPayments?.total,110,'Cash/check remain visible while QBO is unavailable');
assert.equal(absent.paymentsByJob[1].checkNumber,'');
assert.equal(desktopPayments(date,base,[{...cash,appointment_date:'2026-09-05'},job('6','Cash','unknown')]).paymentsByJob.length,1);
assert.equal(base.paymentsByJob.length,1,'Do not mutate the underlying reconciliation');
console.log('Desktop payments passed: cash/check visibility, check references, split tenders, source duplication, dates, missing evidence, and unchanged card matching.');
