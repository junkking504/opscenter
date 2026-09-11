import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { validateMerchantSnapshot, readMerchantSnapshot, reconcileMerchantEvidence, type MerchantSnapshot } from '../lib/merchant-center-evidence';
import type { PaymentByJobRow, PaymentReconciliation } from '../lib/payment-reconciliation';
import { paymentVerification, verifiedPayments } from '../desktop-ui/lib/payment-verification';
import type { FinanceData } from '../desktop-ui/lib/commercial-contract';
const date = '2026-09-10', observedAt = '2026-09-11T16:00:00Z', now = Date.parse(observedAt);
const row: PaymentByJobRow = { date, jkNumber:'JK4000001',customer:'Example Person',paymentMethod:'Credit Card',cardLastFour:'1234',paidAmount:120,revenueAmount:120,tipAmount:0,qboTransactionId:null,qboTransactionType:null,qboStatus:null,reconciliation:'Missing in QBO' };
const transaction = {date,transactionId:'processor-1',amount:120,cardLastFour:'1234',customer:'Example Person',jkNumber:'JK4000001',status:'Approved',transactionType:'Sale',fee:4,observedAt};
const snapshot: MerchantSnapshot = {schema:1,date,collector:'merchant-center-export',accountName:'Junk Krewe',accountLastFour:'4618',collectedAt:observedAt,complete:true,transactions:[transaction]};
const run = (rows=[row], s:MerchantSnapshot|null=snapshot) => reconcileMerchantEvidence(rows,null,s,null,now);
assert.equal(validateMerchantSnapshot(snapshot,date),snapshot);
assert.throws(()=>validateMerchantSnapshot({...snapshot,accountLastFour:'0000'},date));
assert.throws(()=>validateMerchantSnapshot({...snapshot,collector:'qbo-accounting-api'},date));
assert.throws(()=>validateMerchantSnapshot({...snapshot,transactions:[transaction,transaction]},date));
assert.throws(()=>validateMerchantSnapshot({...snapshot,transactions:[{...transaction,amount:NaN}]},date));
const result=run();
assert.equal(result.paymentsByJob[0].processor?.state,'approved');
assert.equal(result.paymentsByJob[0].qboTransactionId,null,'Approval cannot invent an accounting record');
assert.equal(result.paymentsByJob[0].reconciliation,'Missing in QBO','Accounting exception remains');
assert.equal(result.processor.approvedTotal,120);
assert.equal(result.processor.unmatched.length,0);
const view = (rows = result.paymentsByJob): FinanceData['reconciliation'] => ({
 status:'needs_review', generatedAt:observedAt, merchantCenterAvailable:true, merchantCenterFresh:true,
 summary:{junkware_count:1,junkware_total:120,merchant_center_total:0,matched_count:0,net_difference:-120,exception_count:1},
 paymentsByJob:rows,exceptions:[{date,type:'Missing in QBO',reference:row.jkNumber,customer:row.customer,junkwareAmount:120,merchantAmount:null}],
});
const verifiedView = view();
assert.equal(verifiedPayments(verifiedView).total,120);
assert.equal(verifiedPayments(verifiedView).difference,0,'Merchant approval clears the operational payment difference');
assert.equal(verifiedPayments(verifiedView).unresolvedCount,0);
assert.equal(paymentVerification(result.paymentsByJob[0],true),'Verified · Merchant Center');
assert.equal(verifiedView.summary.net_difference,-120,'QBO accounting gap remains separately available');
assert.equal(verifiedView.exceptions.length,1);
assert.equal(verifiedPayments(view(run([{...row,qboTransactionId:'qbo-1',reconciliation:'Matched'}]).paymentsByJob)).total,120,'Both sources count the payment once');
assert.equal(verifiedPayments(view(run([row],{...snapshot,complete:false}).paymentsByJob)).difference,0,'Partial detail evidence can verify the exact payment');
assert.equal(verifiedPayments(view(reconcileMerchantEvidence([row],null,snapshot,null,now+25*3600_000).paymentsByJob)).difference,0,'Historical approval remains verified with its observation timestamp');
for (const state of ['Declined','Voided','Unknown']) {
 assert.equal(verifiedPayments(view(run([row],{...snapshot,transactions:[{...transaction,status:state}]}).paymentsByJob)).difference,-120);
}
assert.equal(verifiedPayments(view(run([row,row]).paymentsByJob)).unresolvedCount,2,'Ambiguous duplicate claims cannot verify either payment');
assert.equal(verifiedPayments(view(run([row],null).paymentsByJob)).difference,-120);
assert.equal(verifiedPayments({...view([{...row,reconciliation:'Matched',qboTransactionId:'qbo-1'}]),merchantCenterFresh:false}).unresolvedCount,1,'Unavailable current QBO evidence is not promoted');
assert.equal(verifiedPayments({...view(),paymentsByJob:[...result.paymentsByJob,{...row,tender:'cash',paidAmount:50,reconciliation:'Recorded'}]}).total,120,'Cash is excluded from card verification');
assert.equal(verifiedPayments({...view([]),status:'not_collected'}).difference,null,'No collected rows must not imply a balanced day');
assert.equal(run([{...row,paidAmount:121}]).paymentsByJob[0].processor?.state,'not_found','Never clear unequal totals');
assert.equal(run([{...row,cardLastFour:'4321'}]).paymentsByJob[0].processor?.state,'not_found','Conflicting card blocks JK match');
assert.equal(run([{...row,jkNumber:'JK4000002'}]).paymentsByJob[0].processor?.state,'not_found','Conflicting job blocks amount/card match');
assert.equal(run([row,{...row}]).paymentsByJob[0].processor?.state,'ambiguous','No processor transaction can be assigned twice');
assert.equal(run([row],{...snapshot,transactions:[transaction,{...transaction,transactionId:'processor-2'}]}).paymentsByJob[0].processor?.state,'ambiguous','Do not arbitrarily choose duplicate charges');
assert.equal(run([row],{...snapshot,transactions:[{...transaction,status:'Declined'}]}).paymentsByJob[0].processor?.state,'review');
assert.equal(run([row],{...snapshot,transactions:[{...transaction,transactionType:'Refund'}]}).processor.approvedTotal,0);
assert.equal(run([row],{...snapshot,transactions:[{...transaction,status:'Unknown'}]}).processor.approvedTotal,0);
assert.equal(run([row],null).paymentsByJob[0].processor?.state,'unavailable');
assert.equal(run([row],{...snapshot,complete:false,transactions:[]}).paymentsByJob[0].processor?.state,'unavailable','Partial coverage cannot establish absence');
assert.equal(reconcileMerchantEvidence([row],null,snapshot,null,now+25*3600_000).paymentsByJob[0].processor?.fresh,false);
assert.equal(run([{...row,qboTransactionId:'qbo-1',reconciliation:'Matched'}]).paymentsByJob[0].qboTransactionId,'qbo-1');
const qbo = {sources:{merchant_center:{collector:'qbo-accounting-api'}},matches:[],exceptions:{merchant_center_only:[{date,transaction_id:'qbo-2',amount:120,card_last_four:'1234'}]}} as unknown as PaymentReconciliation;
assert.equal(reconcileMerchantEvidence([],qbo,snapshot,null,now).processor.unmatched[0].qboTransactionId,'qbo-2');
const original=process.env.OPSBOT_DATA_DIR, temp=fs.mkdtempSync(path.join(os.tmpdir(),'merchant-evidence-test-'));
try {
 process.env.OPSBOT_DATA_DIR=temp;
 assert.equal(readMerchantSnapshot(date).snapshot,null);
 const directory=path.join(temp,'imports/merchant_center/junk_krewe');fs.mkdirSync(directory,{recursive:true});
 fs.writeFileSync(path.join(directory,`transactions-${date}.json`),JSON.stringify(snapshot));
 assert.equal(readMerchantSnapshot(date).snapshot?.complete,true);
 const details={...snapshot,collector:'merchant-center-detail',complete:false,collectedAt:'2026-09-11T17:00:00Z',transactions:[{...transaction,status:'Voided',observedAt:'2026-09-11T17:00:00Z'}]};
 fs.writeFileSync(path.join(directory,`details-${date}.json`),JSON.stringify(details));
 assert.equal(readMerchantSnapshot(date).snapshot?.transactions[0].status,'Voided','Later detail supersedes prior approved observation');
 assert.equal(readMerchantSnapshot(date).snapshot?.complete,false);
 assert.equal(readMerchantSnapshot('../bad').snapshot,null);
} finally {if(original===undefined)delete process.env.OPSBOT_DATA_DIR;else process.env.OPSBOT_DATA_DIR=original;fs.rmSync(temp,{recursive:true,force:true});}
console.log('Merchant evidence passed: source identity, independent posting, conservative matches, duplicate claims, non-sales, stale/partial evidence, and later voids.');
