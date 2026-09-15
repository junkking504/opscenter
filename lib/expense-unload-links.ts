import fs from 'node:fs';
import path from 'node:path';
import type {TruckExpense} from './truck-expense-notifications';
import type {TruckLoadEvent} from './truck-load-status';
import type {DumpExpenseRecord} from '../desktop-ui/lib/dump-expense-contract';
import {canonicalDumpLocation} from './dump-expense-identity';

/** Explicit OpsBot message identity links its saved unload to a verified expense.
 * Ordinary manual unloads and uncertain matches are never removed. */
export function readExpenseUnloadLinks(date:string,expenses:TruckExpense[]):Map<string,string> {
  const root=process.env.WHATSAPP_CREW_EXPENSE_STATE_DIR || path.join(process.env.OPSCENTER_DATA_DIR || process.env.OPSBOT_DATA_DIR || path.join(process.cwd(),'data'),'integrations','whatsapp-crew-expenses');
  const links=new Map<string,string>();
  for(const folder of ['transactions-completed','transactions-processing','transactions-pending']) {
    const directory=path.join(root,folder);
    let files:string[]=[];try{files=fs.readdirSync(directory).filter(file=>file.endsWith('.json'));}catch{continue;}
    for(const file of files) {
      try {
        const data=JSON.parse(fs.readFileSync(path.join(directory,file),'utf8')),record=data.record;
        if(!['junkware_verified','slack_sent'].includes(data.stage) || record?.date!==date || record.kind!=='dump' || typeof record.messageId!=='string')continue;
        const matches=expenses.filter(expense=>expense.kind==='dump' && expense.date===date && !expense.reconciliationNote
          && expense.truck.match(/\d+/)?.[0]===String(record.truck).match(/\d+/)?.[0] && expense.amount===record.cost
          && canonicalDumpLocation(expense.location).trim().toLowerCase()===canonicalDumpLocation(String(record.location||'')).trim().toLowerCase()
          && Math.floor(Date.parse(expense.transactionAt)/60000)===Math.floor(Date.parse(record.reportedAt)/60000));
        if(matches.length===1)links.set(`yard-reset:${`expense:${record.messageId}`.replace(/[^a-zA-Z0-9:_-]+/g,'-').slice(0,180)}`,matches[0].id);
      }catch{/* An unreadable/unverified source cannot retract an unload. */}
    }
  }
  return links;
}
export function withoutDuplicateExpenseUnloads(stored:TruckLoadEvent[],records:DumpExpenseRecord[],links:Map<string,string>):TruckLoadEvent[] {
  const matched=new Set(records.filter(record=>record.enteredAt && record.status==='actual').map(record=>record.actualExpenseId));
  return stored.filter(event=>!(event.kind==='yard_reset' && event.recordedBy==='Verified OpsBot dump expense' && links.has(event.eventId) && matched.has(links.get(event.eventId)!)));
}
