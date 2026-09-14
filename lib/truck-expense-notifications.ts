import fs from 'node:fs';
import path from 'node:path';
import {chicagoDateKey} from './chicago-date';
import type {OperationalAlert} from './operational-alert-presentation';
import type {SlackOpsAlert} from './slack-alerts';
import {formatSlackMessage} from './slack-message-format';
import {truckSlackChannelId} from './slack-truck-channels';

export type TruckExpense = {id:string;date:string;market:string;truck:string;kind:'dump'|'fuel';transactionAt:string;location:string;receipt:string;amount:number;notify:boolean};
function opsBotExpenseDeliveries(entries:TruckExpense[]) {
  const root=process.env.WHATSAPP_CREW_EXPENSE_STATE_DIR || path.join(process.env.OPSCENTER_DATA_DIR || process.env.OPSBOT_DATA_DIR || path.join(process.cwd(),'data'),'integrations','whatsapp-crew-expenses');
  const matches=new Map<string,string | null>();
  for (const folder of ['transactions-completed','transactions-processing','transactions-pending']) {
    let files:string[]=[];try {files=fs.readdirSync(path.join(root,folder));} catch {continue;}
    for (const file of files.filter(file=>file.endsWith('.json'))) {
      try {
        const transaction=JSON.parse(fs.readFileSync(path.join(root,folder,file),'utf8')), record=transaction.record;
        if (!record || !['junkware_verified','slack_sent'].includes(transaction.stage)) continue;
        const candidates=entries.filter(entry=>entry.date===record.date && entry.kind===record.kind
          && entry.truck.match(/\d+/)?.[0]===String(record.truck).match(/\d+/)?.[0]
          && entry.amount===record.cost && entry.location.trim().toLowerCase()===String(record.location).trim().toLowerCase()
          && Math.floor(Date.parse(entry.transactionAt)/60000)===Math.floor(Date.parse(record.reportedAt)/60000));
        if (candidates.length===1) matches.set(candidates[0].id,transaction.slack?.channel && transaction.slack?.ts ? `${transaction.slack.channel}:${transaction.slack.ts}` : null);
      } catch { /* Unverified transactions do not suppress source notifications. */ }
    }
  }
  return matches;
}
export function readTruckExpenses(date:string):TruckExpense[] {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return [];
  const root=process.env.OPSCENTER_DATA_DIR || process.env.OPSBOT_DATA_DIR || path.join(process.cwd(),'data');
  const entries:TruckExpense[]=[];
  for (const market of ['352','477','399','484']) {
    const directory=path.join(root,'history','junkware','expenses',date,market);
    let files:string[]=[];
    try {files=fs.readdirSync(directory).filter(file=>/^\d+\.json$/.test(file));} catch {continue;}
    for (const file of files) {
      try {
        const data=JSON.parse(fs.readFileSync(path.join(directory,file),'utf8'));
        if (data.date!==date || data.market!==market || data.verified!==true || data.truck!==`Truck# ${file.slice(0,-5)}`) continue;
        for (const entry of data.entries || []) {
          if (entry.date!==date || entry.market!==market || entry.truck!==data.truck || !/^[a-f0-9]{32}$/.test(entry.id)
            || !['dump','fuel'].includes(entry.kind) || !Number.isFinite(entry.amount) || entry.amount<=0 || !Number.isFinite(Date.parse(entry.transactionAt))
            || chicagoDateKey(new Date(entry.transactionAt))!==date) continue;
          entries.push({...entry,location:String(entry.location || ''),receipt:String(entry.receipt || ''),notify:entry.notify===true});
        }
      } catch { /* Retain independently verified trucks when another source is unavailable. */ }
    }
  }
  return [...new Map(entries.map(entry=>[entry.id,entry])).values()];
}
export const expenseFingerprint=(entry:TruckExpense)=>`truck_expense:${entry.date}:${entry.id}`;
const clock=(value:string)=>new Intl.DateTimeFormat('en-US',{timeZone:'America/Chicago',hour:'numeric',minute:'2-digit'}).format(new Date(value));
export function truckExpenseTimelineAlerts(date:string):OperationalAlert[] {
  const entries=readTruckExpenses(date), deliveries=opsBotExpenseDeliveries(entries);
  return entries.map(entry=>({sourceMessageIds:deliveries.get(entry.id)?[deliveries.get(entry.id)!]:[],id:expenseFingerprint(entry),eventFingerprint:expenseFingerprint(entry),timestamp:entry.transactionAt,source:'JunkWare',
    label:entry.kind==='dump'?'Dump Expense':'Fuel Expense',domain:'Fleet',owner:'Fleet',truck:entry.truck.replace('#',''),detected:clock(entry.transactionAt),
    title:`${entry.truck.replace('#','')} · ${entry.kind==='dump'?'Dump':'Fuel'} expense`,needsAction:false,
    facts:[{label:'Amount',value:`$${entry.amount.toFixed(2)}`},{label:'Location',value:entry.location || 'Not recorded'},{label:'Recorded transaction time',value:clock(entry.transactionAt)},...(entry.receipt?[{label:'Receipt',value:entry.receipt}]:[])],
    next:'Expense recorded in JunkWare.',href:'https://junkware.junk-king.com/franchise/accounting/truck-records.aspx'}));
}
export function truckExpenseSlackNotifications(date:string):SlackOpsAlert[] {
  if (date!==chicagoDateKey()) return [];
  const entries=readTruckExpenses(date).filter(entry=>entry.notify);
  const deliveries=opsBotExpenseDeliveries(entries);
  return entries.filter(entry=>!deliveries.has(entry.id)).flatMap(entry=>{
    const channelId=truckSlackChannelId(entry.truck,'');
    if (!channelId) return [];
    const alert=truckExpenseTimelineAlertsFromEntry(entry);
    return [{fingerprint:expenseFingerprint(entry),kind:'truck_expense' as const,lifecycle:'notification' as const,severity:'warning' as const,channelId,
      title:alert.title,detail:'Expense recorded in JunkWare.',nextAction:'',href:alert.href,fields:alert.facts,plainText:formatSlackMessage({icon:entry.kind==='dump'?':wastebasket:':':fuelpump:',title:alert.title,fields:alert.facts,href:alert.href})+`\n\n_Alert ID: ${expenseFingerprint(entry)}_`}];
  });
}
function truckExpenseTimelineAlertsFromEntry(entry:TruckExpense) {
  return {title:`${entry.kind==='dump'?'Dump':'Fuel'} Expense · ${entry.truck.replace('#','')}`,href:'https://junkware.junk-king.com/franchise/accounting/truck-records.aspx',
    facts:[{label:'Truck',value:entry.truck.replace('#','')},{label:'Amount',value:`$${entry.amount.toFixed(2)}`},{label:'Location',value:entry.location || 'Not recorded'},{label:'Recorded transaction time',value:clock(entry.transactionAt)},...(entry.receipt?[{label:'Receipt',value:entry.receipt}]:[])]};
}

export function mergeTruckExpenseAlerts(alerts:OperationalAlert[], expenses:OperationalAlert[]):OperationalAlert[] {
  return [...alerts.filter(alert=>!expenses.some(expense=>expense.eventFingerprint===alert.eventFingerprint || expense.sourceMessageIds?.includes(alert.id))),
    ...expenses.map(expense=>({...expense,sourceMessageIds:[...new Set([...(expense.sourceMessageIds || []),...alerts.filter(alert=>alert.eventFingerprint===expense.eventFingerprint).flatMap(alert=>[alert.id,...(alert.sourceMessageIds || [])])])]}))];
}
