import assert from 'node:assert/strict';
import React, { createElement } from 'react';
Object.assign(globalThis, { React });
import { renderToStaticMarkup } from 'react-dom/server';
import { FinanceNumbers } from '../desktop-ui/finance-numbers';
import type { FinanceData } from '../desktop-ui/lib/commercial-contract';
import type { FinancialStatement } from '../desktop-ui/lib/financial-statements';
const statement = {id:'qbo',company:'Fixture',sourceKind:'qbo',sourceName:'Fixture',month:'2026-09',reportThrough:'2026-09-16',periodEnd:'2026-09-16',basis:'Accrual',totals:{income:987600}} as FinancialStatement;
const data = {month:{label:'September 2026',through:'2026-09-16',revenue:12345},reconciliation:{recordedPayments:{total:456}},statements:{available:true,records:[statement]}} as FinanceData;
const render = (value = data) => renderToStaticMarkup(createElement(FinanceNumbers,{data:value,date:'2026-09-16'}));
assert.match(render(), /\$12,345/);
assert.match(render(), /\$456/);
assert.match(render(), /\$9,876/);
assert.match(render(), /Through Sep 16, Accrual basis/);
const withRecords = (records: FinancialStatement[]) => ({...data,statements:{...data.statements!,records}});
for(const records of [[],[{...statement,sourceKind:'workbook' as const}],[{...statement,month:'2026-08'}],[{...statement,periodEnd:undefined}],[{...statement,totals:{...statement.totals,income:NaN}}],[statement,{...statement,company:'Other',periodEnd:'2026-09-15'}],[statement,{...statement,company:'Other',basis:'Cash' as const}]]) {
  assert.match(render(withRecords(records)), /class="missing-value">Unavailable/);
  assert.doesNotMatch(render(withRecords(records)), /\$9,876/);
}
assert.match(render(withRecords([statement,{...statement,id:'revision',reportThrough:'2026-09-17',totals:{...statement.totals,income:10000}}])), /\$100/);
assert.match(render(withRecords([statement,{...statement,company:'Other'}])), /\$19,752/);
assert.match(render(withRecords([{...statement,totals:{...statement.totals,income:0}}])), /\$0/);
const unavailable={...data,month:{...data.month,revenue:null},reconciliation:{...data.reconciliation,recordedPayments:undefined},statements:undefined};
assert.equal((render(unavailable).match(/class="missing-value">Unavailable/g)||[]).length,3);
assert.doesNotMatch(render(unavailable),/\$0/);
console.log('Finance number strip: distinct periods and values, cents, missing inputs, wrong source/month, incompatible cutoffs/bases, revisions, company totals and real zero passed.');
