import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {readDesktopKrewe, readDesktopKreweDay, runDesktopKreweAction} from '../lib/desktop-krewe';
import {readCommandCrewCorrections} from '../lib/command-crew-corrections';
import {readKreweHours} from '../lib/desktop-krewe-hours';
import {payPeriodDates} from '../lib/pay-period';
import {payrollCorrectionForEmployee} from '../lib/payroll-corrections';
import {manualBonusEntriesForEmployee} from '../lib/manual-bonuses';

const originalDirectory=process.cwd();
const originalData=process.env.OPSBOT_DATA_DIR;
const originalReceipts=process.env.OPSCENTER_DESKTOP_PEOPLE_FLEET_DIR;
const directory=fs.mkdtempSync(path.join(os.tmpdir(),'krewe-day-edits-'));
process.chdir(directory);
process.env.OPSBOT_DATA_DIR=path.join(directory,'data');
process.env.OPSCENTER_DESKTOP_PEOPLE_FLEET_DIR=path.join(directory,'receipts');
const metricsDirectory=path.join(directory,'data/history/daily_metrics');
fs.mkdirSync(metricsDirectory,{recursive:true});
const period=payPeriodDates('2026-09-05');
const employee={name:'Synthetic Crew',clock_in:'08:00 AM',clock_out:'04:00 PM',hours_worked:8,hourly_rate:20,individual_revenue:100,regular_hours:8,overtime_hours:0,hourly_pay:160,total_bonus:0,tips:0,supplemental_pay:0,total_pay:160};
const write=(date:string,rows:unknown[],payrollOnly=false)=>fs.writeFileSync(path.join(metricsDirectory,`daily_metrics_${date}.json`),JSON.stringify({[payrollOnly?'payroll_records':'employee_leaderboard']:rows}));
try {
  // Every lookup is satisfied by synthetic local files, including the holiday.
  for(const date of [...period.dates,...payPeriodDates('2026-09-07').dates]) write(date,[]);
  write(period.start,[employee,{...employee,name:'Open Shift',clock_out:''},{...employee,name:'Job Only',clock_in:'',jobs_completed:3},{...employee,name:'Roster Only',clock_in:'',hours_worked:0},{...employee,name:'Placeholder Clock',clock_in:'—'}]);
  const today=readDesktopKrewe(period.start,'today','admin');
  assert.deepEqual(today.members.map(row=>row.name).sort(),['Open Shift','Synthetic Crew']);
  assert.equal(today.totals.revenue,200,'Today totals must use the filtered clock-in roster');
  assert.equal(readDesktopKrewe('2026-09-07','today','admin').members.length,0);
  assert.equal(readDesktopKrewe('2026-09-07','today','admin').missingDates.length,0);
  assert.ok(readDesktopKrewe('2026-09-05','payperiod','admin').members.some(row=>row.name==='Job Only'),'Today filtering must not remove period/month records');

  const missedDate='2026-08-26';
  const missed=readDesktopKreweDay(missedDate,employee.name,'2026-09-05','admin');
  assert.equal(missed.member.clockIn,''); assert.equal(missed.member.hourlyRate,null,'Never borrow another day’s rate');
  const request={date:missedDate,periodDate:'2026-09-05',name:employee.name,action:'correction',expectedVersion:missed.member.actionVersions!.correction,requestId:randomUUID(),values:{clockIn:'8:00 AM',clockOut:'12:00 PM',hourlyRate:22,note:'Synthetic missed shift'}};
  assert.equal(runDesktopKreweAction(request,'test@example.invalid','admin').status,'verified');
  assert.equal(runDesktopKreweAction(request,'test@example.invalid','admin').status,'verified','Replaying a request must not write twice');
  assert.equal(payrollCorrectionForEmployee(missedDate,employee.name)?.hourlyRate,22);
  assert.equal(payrollCorrectionForEmployee('2026-09-05',employee.name),null,'Anchor date must not be changed');
  assert.equal(readDesktopKrewe(missedDate,'today','admin').members[0].hours,4,'Correction-only shifts appear in Today');
  assert.equal(readKreweHours('2026-09-05').employees.find(row=>row.name===employee.name)?.weeks[0].days[2].hours,4);
  assert.throws(()=>runDesktopKreweAction({...request,requestId:randomUUID()},'test@example.invalid','admin'),/unconfirmed JunkWare change/);
  assert.throws(()=>readDesktopKreweDay('2026-09-07',employee.name,'2026-09-05','admin'),/within/);
  assert.throws(()=>runDesktopKreweAction({...request,date:'2026-09-07',requestId:randomUUID()},'test@example.invalid','admin'),/within/);
  assert.throws(()=>readDesktopKreweDay(missedDate,'Unknown Person','2026-09-05','admin'),/not found/);
  assert.throws(()=>readDesktopKreweDay(missedDate,employee.name,'2026-09-05','operator'),/Manager access/);
  assert.throws(()=>runDesktopKreweAction({...request,requestId:randomUUID()},'test@example.invalid','operator'),/role/);

  const weekTwo='2026-09-01';
  const bonusDay=readDesktopKreweDay(weekTwo,employee.name,'2026-09-05','admin');
  const bonus={date:weekTwo,periodDate:'2026-09-05',name:employee.name,action:'bonus',expectedVersion:bonusDay.member.actionVersions!.bonus,requestId:randomUUID(),values:{amount:25,note:'Synthetic bonus'}};
  assert.equal(runDesktopKreweAction(bonus,'test@example.invalid','admin').status,'verified');
  assert.equal(runDesktopKreweAction(bonus,'test@example.invalid','admin').status,'verified');
  assert.equal(manualBonusEntriesForEmployee(weekTwo,employee.name).length,1);
  assert.equal(manualBonusEntriesForEmployee('2026-09-05',employee.name).length,0);
  assert.equal(readDesktopKreweDay(weekTwo,employee.name,'2026-09-05','admin').manualBonuses[0].amount,25);
  write('2026-09-02',[{...employee,name:'Payroll Only'}],true);
  assert.equal(readDesktopKreweDay('2026-09-03','Payroll Only','2026-09-05','admin').member.name,'Payroll Only');
  for(const date of period.dates) assert.equal(readDesktopKreweDay(date,employee.name,'2026-09-05','admin').date,date);
  // A full week with explicit zero-hour off days supplies the overtime basis.
  for(const date of ['2026-08-31','2026-09-01','2026-09-02','2026-09-03','2026-09-04','2026-09-05','2026-09-06']) write(date,[{...employee,hours_worked:0,clock_in:'',clock_out:'',hourly_pay:0,total_pay:0}]);
  write('2026-08-31',[{...employee,hours_worked:11.6}]);
  write('2026-09-01',[{...employee,hours_worked:11.07}]);
  write('2026-09-03',[{...employee,hours_worked:11.8}]);
  write('2026-09-06',[{...employee,hourly_rate:17,hours_worked:11.1,hourly_pay:188.7,tips:36.98,total_pay:225.68}]);
  const before=readDesktopKreweDay('2026-09-06',employee.name,'2026-09-06','admin');
  const sourceFile=path.join(metricsDirectory,'daily_metrics_2026-09-06.json');
  const untouched=fs.readFileSync(sourceFile,'utf8');
  runDesktopKreweAction({date:'2026-09-06',name:employee.name,action:'correction',expectedVersion:before.member.actionVersions!.correction,requestId:randomUUID(),values:{clockIn:'7:15 AM',clockOut:'6:00 PM',hourlyRate:17,note:'Correct synthetic clocks'}},'test@example.invalid','admin');
  const after=readDesktopKrewe('2026-09-06','today','admin').members.find(row=>row.name===employee.name)!;
  assert.equal(after.labor,227.12); assert.equal(after.totalPay,264.1); assert.equal(after.issue,'');
  assert.match(after.payNote!,/JunkWare verification pending/);
  assert.equal(readCommandCrewCorrections('2026-09-06','operator'),undefined,'Payroll corrections retain the manager access boundary');
  assert.equal(readCommandCrewCorrections('2026-09-06','Administrator')?.members.find(row=>row.name===employee.name)?.totalPay,264.1);
  const periodMember=readDesktopKrewe('2026-09-06','payperiod','admin').members.find(row=>row.name===employee.name)!;
  assert.equal(periodMember.days.find(day=>day.date==='2026-09-06')?.totalPay,264.1,'Weekly cards use the corrected daily pay');
  assert.equal(fs.readFileSync(sourceFile,'utf8'),untouched,'Saving a correction does not rewrite collected JunkWare data');
  console.log('Krewe day edits passed: all 14 dates, missed shifts, isolated dates/rates/versions, bonus read-back and replay, payroll-only roster, role guards, and clock-in-only Today with holiday empty state.');
} finally {
  process.chdir(originalDirectory);
  if(originalData===undefined) delete process.env.OPSBOT_DATA_DIR; else process.env.OPSBOT_DATA_DIR=originalData;
  if(originalReceipts===undefined) delete process.env.OPSCENTER_DESKTOP_PEOPLE_FLEET_DIR; else process.env.OPSCENTER_DESKTOP_PEOPLE_FLEET_DIR=originalReceipts;
  fs.rmSync(directory,{recursive:true,force:true});
}
