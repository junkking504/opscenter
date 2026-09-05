import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { crewRows, readMetrics, type AnyRecord } from '@/lib/opsData';
import { workedOrAttributedToJobToday } from '@/lib/crew-attendance';
import { buildCrewCallInPlan } from '@/lib/crew-call-in-recommendations';
import { payPeriodForDate } from '@/lib/pay-period';
import { payrollCorrectionForEmployee, normalizePayrollEmployeeKey, upsertPayrollCorrection } from '@/lib/payroll-corrections';
import { manualBonusEntriesForEmployee, upsertManualBonusEntry } from '@/lib/manual-bonuses';
import { opsRoleCan, type InteractiveOpsRole } from '@/lib/ops-roles';
import { calculateLivePay } from '@/lib/live-pay';
import { chicagoDateKey, addDays } from '@/lib/report-dates';
import { readKreweHours } from '@/lib/desktop-krewe-hours';
import { nullableNumber as num, sumObserved, validDesktopDate, type CrewAmounts, type DesktopCrewMember, type DesktopKreweSnapshot, type KreweView, type CallInDecision, type DesktopLocalReceipt } from '../desktop-ui/lib/people-fleet-contract';

/** Registered adapters invoke the existing domain writers; their private receipt
 * journal persists intent and verification independently of any browser session.
 * Pending/uncertain runs must be reconciled against the domain store before an
 * operator repairs the receipt. Never retry the writer to discover its result.
 */
export const DESKTOP_PEOPLE_FLEET_ACTIONS = {
  'krewe.correction': { permission: 'sensitive.write', risk: 3, authority: 'opscenter_authoritative', verifier: 'payrollCorrectionForEmployee' },
  'krewe.bonus': { permission: 'sensitive.write', risk: 3, authority: 'opscenter_authoritative', verifier: 'manualBonusEntriesForEmployee' },
  'krewe.callin': { permission: 'operations.write', risk: 1, authority: 'opscenter_authoritative', verifier: 'call-in decision read-back' },
  'fleet.maintenance': { permission: 'operations.write', risk: 1, authority: 'opscenter_authoritative', verifier: 'readFleetMaintenanceStore' },
  'fleet.issue': { permission: 'operations.write', risk: 1, authority: 'opscenter_authoritative', verifier: 'readFleetIssueStore' },
  'fleet.checklist': { permission: 'operations.write', risk: 1, authority: 'opscenter_authoritative', verifier: 'readFleetChecklistStore' },
  'fleet.load_start': { permission: 'operations.write', risk: 1, authority: 'opscenter_authoritative', verifier: 'readTruckLoadStatuses' },
  'fleet.load_reset': { permission: 'operations.write', risk: 1, authority: 'opscenter_authoritative', verifier: 'readTruckLoadStatuses' },
  'fleet.load_snapshot': { permission: 'operations.write', risk: 1, authority: 'opscenter_authoritative', verifier: 'readTruckLoadStatuses' },
} as const;
export const desktopVersion = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const stateDirectory = () => process.env.OPSCENTER_DESKTOP_PEOPLE_FLEET_DIR || path.join(process.env.OPSBOT_DATA_DIR || path.join(process.cwd(), 'data'), 'desktop-people-fleet');
function readPrivate<T>(name: string, empty: T): T { try { return JSON.parse(fs.readFileSync(path.join(stateDirectory(), name), 'utf8')); } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return empty; throw error; } }
function writePrivate(name: string, value: unknown) { fs.mkdirSync(stateDirectory(), { recursive: true, mode: 0o700 }); const file = path.join(stateDirectory(), name); fs.writeFileSync(`${file}.${process.pid}.tmp`, JSON.stringify(value), { mode: 0o600 }); fs.renameSync(`${file}.${process.pid}.tmp`, file); }
/** Return only an actor's own receipt status, never the saved sensitive input. */
export function readDesktopLocalReceipt(requestId: string, actor: string, workspace: 'fleet' | 'krewe') {
  if (!/^[0-9a-f-]{36}$/i.test(requestId)) return null;
  const row = readPrivate<DesktopLocalReceipt[]>('receipts.json', []).find(receipt => receipt.requestId === requestId && receipt.actor === actor && receipt.action.startsWith(`${workspace}.`));
  return row ? {requestId: row.requestId, status: row.status, updatedAt: row.updatedAt} : null;
}
export function executeDesktopLocalAction(input: { requestId: string; action: string; entity: string; expectedVersion: string; values: Record<string, unknown> }, actor: string, current: () => unknown, execute: () => unknown, verify: (result: unknown) => boolean): DesktopLocalReceipt {
  if(JSON.stringify(input.values).length>20_000) throw new Error('The action input is too large.');
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(input.requestId) || !/^[a-f0-9]{64}$/.test(input.expectedVersion)) throw new Error('A request ID and current record version are required.');
  fs.mkdirSync(stateDirectory(), { recursive: true, mode: 0o700 });
  const lock = path.join(stateDirectory(), 'write.lock');
  let descriptor: number;
  try { descriptor = fs.openSync(lock, 'wx', 0o600); } catch { throw new Error('An operation is in progress or needs recovery. Refresh before retrying.'); }
  try {
    const fingerprint = desktopVersion(input);
    const receipts = readPrivate<DesktopLocalReceipt[]>('receipts.json', []);
    const existing = receipts.find(row => row.requestId === input.requestId);
    if (existing) { if (existing.actor !== actor || existing.fingerprint !== fingerprint) throw new Error('Request ID belongs to another operation.'); return existing; }
    if (receipts.some(row => row.entity === input.entity && (row.status === 'pending' || row.status === 'uncertain'))) throw new Error('This record has an unverified write. Verify its saved state before another change.');
    if (desktopVersion(current()) !== input.expectedVersion) throw new Error('This record changed. Refresh and review the current values.');
    const receipt: DesktopLocalReceipt = { requestId: input.requestId, action: input.action, entity: input.entity, actor, fingerprint, input: input.values, expectedVersion: input.expectedVersion, status: 'pending', updatedAt: new Date().toISOString() };
    receipts.push(receipt); writePrivate('receipts.json', receipts);
    try { const result = execute(); receipt.status = result ? verify(result) ? 'verified' : 'uncertain' : 'failed'; } catch { receipt.status = 'uncertain'; }
    receipt.updatedAt = new Date().toISOString(); writePrivate('receipts.json', receipts); return receipt;
  } finally { fs.closeSync(descriptor); fs.unlinkSync(lock); }
}
function decisions() { return readPrivate<CallInDecision[]>('call-in.json', []); }
const amountKeys: Array<keyof CrewAmounts> = ['hours','regularHours','overtimeHours','jobs','revenue','labor','tips','bonuses','supplemental','totalPay'];
const nameOf = (row: AnyRecord) => String(row.name || row.employee_name || row.employee || row.crew_member || '').trim();
const keyOf = normalizePayrollEmployeeKey;
const fields = (row: AnyRecord): CrewAmounts => ({ hours: num(row,['hours_worked','employee_hours','hours','total_hours','clocked_hours','labor_hours']), regularHours: num(row,['regular_hours']), overtimeHours: num(row,['overtime_hours','ot_hours']), jobs: num(row,['jobs_completed','completed_jobs','completed_job_count','jobs','job_count']), revenue: num(row,['individual_revenue','revenue_generated','employee_revenue','credited_revenue','revenue']), labor: num(row,['hourly_pay','base_pay','regular_pay','wage_pay','labor_pay']), tips: num(row,['tip','employee_tips','tips_earned','tip_pay','tips','allocated_tips','tip_share','daily_tips']), bonuses: num(row,['total_bonus','bonus','daily_bonus','bonus_pay']), supplemental: num(row,['supplemental_daily_pay','supplemental_pay']), totalPay: num(row,['total_pay','total_earnings','employee_total_pay','daily_pay']) });
function csvRows(date: string, suffix: string): AnyRecord[] {
  const file = path.join(process.env.OPSBOT_DATA_DIR || path.join(process.cwd(),'data'),'history','junkware',suffix==='employee_rates'?`junkware_employee_rates_${date}.csv`:`junkware_${suffix}_${date}_summary.csv`);
  if (!fs.existsSync(file)) return [];
  const split = (line: string) => { const result: string[] = []; let cell = ''; let quote = false; for (let i=0;i<line.length;i++) { const c=line[i]; if(c==='"') { if(quote && line[i+1]==='"'){cell+='"';i++;}else quote=!quote; } else if(c===','&&!quote){result.push(cell);cell='';}else cell+=c; } result.push(cell); return result; };
  const lines = fs.readFileSync(file,'utf8').split(/\r?\n/).filter(Boolean); const headers = split(lines.shift() || '');
  return lines.map(line => Object.fromEntries(split(line).map((value,index) => [headers[index],value])));
}
function dayMembers(date: string, payroll: boolean): DesktopCrewMember[] {
  const metrics=readMetrics(date); const clocks=csvRows(date,'employees'); const rates=csvRows(date,'employee_rates');
  const sourceRows=[...crewRows(metrics)]; for(const clock of clocks) if(!sourceRows.some(row=>keyOf(nameOf(row))===keyOf(nameOf(clock)))) sourceRows.push(clock);
  return sourceRows.filter(row=>nameOf(row)).map(row=>{
    const name=nameOf(row); const id=keyOf(name); const clock=clocks.find(item=>keyOf(nameOf(item))===id); const rate=rates.find(item=>keyOf(nameOf(item))===id);
    const correction=payrollCorrectionForEmployee(date,name); const clockIn=correction?.clockIn || String(clock?.time_in || row.clock_in || row.time_in || row.clockIn || ''); const clockOut=correction ? correction.clockOut : String(clock?.time_out || row.clock_out || row.time_out || row.clockOut || '');
    const amounts=fields(row); const hourlyRate=correction?.hourlyRate ?? num(rate || row,['hourly_rate','hourly_rate_raw']);
    // Weekly overtime cannot be inferred from a single shift. Only calculate when the source provides its prior-hours basis.
    const prior=num(row,['weekly_hours_before_shift']);
    if(correction && prior!==null) { const pay=calculateLivePay({date,clockIn,clockOut,hourlyRate,weeklyHoursBeforeShift:prior,tips:amounts.tips ?? 0,totalBonus:amounts.bonuses ?? 0,isSalary:Boolean(row.is_salary)}); amounts.hours=pay.workedHours; amounts.regularHours=pay.regularHours; amounts.overtimeHours=pay.overtimeHours; amounts.labor=pay.hourlyLaborCost; amounts.totalPay=pay.totalPay===null || amounts.supplemental===null ? null : pay.totalPay+amounts.supplemental; }
    else if(correction) { amounts.labor=null; amounts.totalPay=null; }
    const working=workedOrAttributedToJobToday({...row,clock_in:clockIn}, {timeIn:clockIn}); const truck=Array.isArray(row.trucks)?row.trucks.join(', '):String(row.truck || row.assigned_truck || clock?.trucks || 'Unassigned');
    const member: DesktopCrewMember={...amounts,id,name,initials:name.split(/\s+/).map(v=>v[0]).slice(0,2).join(''),role:Array.isArray(row.driver_trucks)&&row.driver_trucks.length?'Driver':String(row.role || 'Krewe'),truck,working,clockIn,clockOut,hourlyRate:payroll?hourlyRate:null,status:clockIn?clockOut?'Clocked out':'Clocked in':working?'Job attributed':'Off today',issue:working&&!clockIn?'Missing clock-in':date<chicagoDateKey()&&clockIn&&!clockOut?'Missing clock-out':correction&&prior===null?'Correction saved; weekly payroll calculation requires review':'',version:desktopVersion({row,correction,bonuses:manualBonusEntriesForEmployee(date,name)}),correction:payroll?correction:null,days:[]};
    if(!payroll) for(const field of ['labor','tips','bonuses','supplemental','totalPay'] as const) member[field]=null;
    return member;
  });
}
export function readDesktopKrewe(date: string, view: KreweView, role: InteractiveOpsRole): DesktopKreweSnapshot {
  if(!validDesktopDate(date)) throw new Error('A valid operating date is required.');
  const payrollVisible=opsRoleCan(role,'finance.read'); if((view==='monthly'||view==='payperiod')&&!payrollVisible) throw new Error('Manager access is required for payroll.');
  const period=payPeriodForDate(date); const start=view==='monthly'?`${date.slice(0,7)}-01`:view==='payperiod'?period.start:date; const end=view==='payperiod'?(period.end<chicagoDateKey()?period.end:chicagoDateKey()):view==='monthly'&&date>chicagoDateKey()?chicagoDateKey():date;
  const grouped=new Map<string,DesktopCrewMember>(); const missingDates:string[]=[];
  for(let cursor=start;cursor<=end;cursor=addDays(cursor,1)){ if(!readMetrics(cursor)) missingDates.push(cursor); for(const row of dayMembers(cursor,payrollVisible)){ const existing=grouped.get(row.id); const day={...Object.fromEntries(amountKeys.map(key=>[key,row[key]])) as CrewAmounts,date:cursor,clockIn:row.clockIn,clockOut:row.clockOut}; if(existing){existing.days.push(day);for(const key of amountKeys) existing[key]=sumObserved([existing[key],row[key]]);}else grouped.set(row.id,{...row,days:[day]}); } }
  // Use the same corrected-hours eligibility as the weekly employee cards.
  // Revenue, tips, or bonuses alone do not qualify a zero-hour roster entry.
  const eligibleIds=view==='payperiod'?new Set(readKreweHours(date).employees.map(employee=>employee.id)):null;
  const members=[...grouped.values()].filter(member=>!eligibleIds||eligibleIds.has(member.id)).sort((a,b)=>(b.revenue??-1)-(a.revenue??-1));
  const plan=view==='callin'?buildCrewCallInPlan(date):null;
  const callIn=plan?{...plan,recommendations:[...plan.recommendations,...plan.alternates].map(candidate=>{const decision=decisions().find(row=>row.targetDate===plan.targetDate&&keyOf(row.name)===keyOf(candidate.name))||null;return {...candidate,decision,version:desktopVersion(decision)};})}:null;
  return {date,view,start,end,sourceUpdatedAt:readMetrics(date)?.payroll_as_of||readMetrics(date)?.generated_at||null,missingDates,payrollVisible,canWrite:opsRoleCan(role,'sensitive.write'),members,totals:Object.fromEntries(amountKeys.map(key=>[key,sumObserved(members.map(member=>member[key]))])) as CrewAmounts,callIn};
}
export function runDesktopKreweAction(body: Record<string, unknown>, actor: string, role: InteractiveOpsRole) {
  const date=String(body.date||''); const name=String(body.name||''); const action=String(body.action||''); const values=(body.values||{}) as Record<string,unknown>;
  if(!validDesktopDate(date)||!name||!['correction','bonus','callin'].includes(action)) throw new Error('A valid employee, date, and action are required.');
  if(!opsRoleCan(role,DESKTOP_PEOPLE_FLEET_ACTIONS[`krewe.${action}` as 'krewe.callin'|'krewe.correction'|'krewe.bonus'].permission)) throw new Error('Your role cannot make this change.');
  if(action!=='callin' && !dayMembers(date,true).some(row=>row.id===keyOf(name))) throw new Error('Employee was not found in the selected source date.');
  if(action==='callin' && ![...buildCrewCallInPlan(date).recommendations,...buildCrewCallInPlan(date).alternates].some(row=>keyOf(row.name)===keyOf(name))) throw new Error('Employee is not a current call-in candidate.');
  const targetDate=action==='callin'?buildCrewCallInPlan(date).targetDate:date;
  const current=()=>action==='callin'?decisions().find(row=>row.targetDate===targetDate&&keyOf(row.name)===keyOf(name))||null:action==='correction'?payrollCorrectionForEmployee(date,name):manualBonusEntriesForEmployee(date,name);
  if(action==='correction'&&(!String(values.note||'').trim()||!String(values.clockIn||'').trim()||!Number.isFinite(Number(values.hourlyRate))||Number(values.hourlyRate)<=0)) throw new Error('Clock-in, hourly rate, and a correction reason are required.');
  if(action==='bonus'&&(!String(values.note||'').trim()||!Number.isFinite(Number(values.amount))||Number(values.amount)<=0)) throw new Error('A positive bonus and reason are required.');
  if(action==='callin'&&!['Recommended','Called','Confirmed','Unavailable'].includes(String(values.status))) throw new Error('Choose a valid call-in outcome.');
  return executeDesktopLocalAction({requestId:String(body.requestId||''),action:`krewe.${action}`,entity:`krewe:${targetDate}:${keyOf(name)}:${action}`,expectedVersion:String(body.expectedVersion||''),values},actor,current,()=>{
    if(action==='correction') return upsertPayrollCorrection({employeeName:name,workDate:date,clockIn:String(values.clockIn),clockOut:String(values.clockOut||''),hourlyRate:Number(values.hourlyRate),note:String(values.note),updatedBy:actor});
    if(action==='bonus') return upsertManualBonusEntry({entryId:`desktop-${body.requestId}`,employeeName:name,workDate:date,amount:Number(values.amount),note:String(values.note)});
    const decision:CallInDecision={name,targetDate,status:String(values.status) as CallInDecision['status'],note:String(values.note||''),actor,updatedAt:new Date().toISOString()};writePrivate('call-in.json',[...decisions().filter(row=>!(row.targetDate===targetDate&&keyOf(row.name)===keyOf(name))),decision]);return decision;
  },result=>action==='bonus'?manualBonusEntriesForEmployee(date,name).some(entry=>desktopVersion(entry)===desktopVersion(result)):desktopVersion(current())===desktopVersion(result));
}
export function kreweActionVersions(date: string,name:string) { return {correction:desktopVersion(payrollCorrectionForEmployee(date,name)),bonus:desktopVersion(manualBonusEntriesForEmployee(date,name))}; }
