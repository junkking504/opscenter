import {execFileSync} from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import {chromium,type Browser,type Page} from 'playwright';
import {normalizePayrollEmployeeKey,type PayrollCorrection} from '../lib/payroll-corrections';
import type {JunkwareShift} from '../lib/junkware-payroll-sync';
export const TIMESHEETS_URL='https://junkware.junk-king.com/franchise/accounting/timesheets.aspx';
const clean=(value:string)=>value.replace(/\s+/g,' ').trim();
const money=(value:string)=>Number(value.replace(/[$,]/g,''));
export function sourceClock(value:string) {const match=clean(value).match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);return match?`${match[1].padStart(2,'0')}:${match[2]} ${match[3].toUpperCase()}`:'';}
export function sourceHours(value:string):number|null {const match=value.match(/\(([\d.]+)\)/);return match?Number(match[1]):null;}
export function junkwareDate(date:string) {if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||!Number.isFinite(Date.parse(date))||new Date(date+'T12:00:00Z').toISOString().slice(0,10)!==date)throw new Error('Invalid work date.');return `${date.slice(5,7)}/${date.slice(8,10)}/${date.slice(0,4)}`;}
function dateKey(value:string) {const match=clean(value).match(/^(\d{2})\/(\d{2})\/(\d{4})$/);if(!match)throw new Error('JunkWare shift date is unavailable.');return `${match[3]}-${match[1]}-${match[2]}`;}
export function parseShift(cells:string[]):JunkwareShift {
  if(cells.length!==11||!Number.isFinite(money(cells[3])))throw new Error('JunkWare timesheet columns changed.');
  if(!sourceClock(cells[1])||(cells[2].trim()&&!sourceClock(cells[2])))throw new Error('JunkWare shift times could not be read.');
  const firstOT=sourceHours(cells[8]),secondOT=sourceHours(cells[9]);
  return {workDate:dateKey(cells[0]),clockIn:sourceClock(cells[1]),clockOut:sourceClock(cells[2]),hourlyRate:money(cells[3]),hours:sourceHours(cells[4]),regularHours:sourceHours(cells[6]),overtimeHours:firstOT===null||secondOT===null?null:firstOT+secondOT,labor:cells[10].trim()&&Number.isFinite(money(cells[10]))?money(cells[10]):null};
}
function secret(name:string,service:string) {if(process.env[`${name}_BASE64`])return Buffer.from(process.env[`${name}_BASE64`]!,'base64').toString('utf8');if(process.env[name])return process.env[name]!;try{return execFileSync('security',['find-generic-password','-w','-s',service],{encoding:'utf8',stdio:['ignore','pipe','ignore'],timeout:10000}).trim();}catch{return '';}}
export async function openTimesheets():Promise<{browser:Browser;page:Page}> {
  const browser=await chromium.launch({headless:true});
  try {
    const file=path.join(process.env.OPSBOT_DATA_DIR||path.join(process.env.HOME||'','.openclaw','workspace','opsbot','data'),'protected','junkware_storage_state.json');
    const context=await browser.newContext(fs.existsSync(file)?{storageState:file}:{}),page=await context.newPage();page.setDefaultTimeout(30000);
    await page.goto(TIMESHEETS_URL,{waitUntil:'domcontentloaded'});
    if(page.url().includes('/account/login.aspx')) {
      const username=secret('JUNKWARE_USERNAME','opsbot-junkware-username'),password=secret('JUNKWARE_PASSWORD','opsbot-junkware-password');
      if(!username||!password)throw new Error('JunkWare credentials are unavailable.');
      await page.locator('#ctl00_Content_UsernameTB').fill(username);await page.locator('#ctl00_Content_PasswordTB').fill(password);
      await Promise.all([page.waitForNavigation({waitUntil:'domcontentloaded'}),page.locator('#ctl00_Content_LoginBtn').click()]);await page.goto(TIMESHEETS_URL,{waitUntil:'domcontentloaded'});
    }
    if(page.url()!==TIMESHEETS_URL)throw new Error('JunkWare timesheets could not be authenticated.');
    return {browser,page};
  }catch(error){await browser.close();throw error;}
}
/** Standard WebForms postback avoids the source site's broken AJAX callback.
 * Event targets come from the live control, never from a guessed row index. */
export async function postback(page:Page,target:string,button?:{name:string;value:string}) {
  await Promise.all([page.waitForNavigation({waitUntil:'domcontentloaded',timeout:30000}),page.evaluate(({target,button})=>{
    const form=document.forms[0],event=document.getElementById('__EVENTTARGET') as HTMLInputElement,args=document.getElementById('__EVENTARGUMENT') as HTMLInputElement;
    if(!form||!event||!args)throw new Error('JunkWare form is unavailable.');
    event.value=target;args.value='';
    if(button){const input=document.createElement('input');input.type='hidden';input.name=button.name;input.value=button.value;form.append(input);}
    HTMLFormElement.prototype.submit.call(form);
  },{target,button})]);
}
export async function linkPostback(page:Page,selector:string) {
  const link=page.locator(selector);if(await link.count()!==1)throw new Error('JunkWare edit control is not unique.');
  const href=await link.getAttribute('href'),target=href?.match(/^javascript:__doPostBack\('([^']+)',''\)$/)?.[1];
  if(!target)throw new Error('JunkWare edit control changed.');await postback(page,target);
}
async function selectDay(page:Page,date:string,market?:string) {
  await page.goto(TIMESHEETS_URL,{waitUntil:'domcontentloaded'});
  if(market&&await page.locator('#ctl00_FranchiseDD').inputValue()!==market){await page.locator('#ctl00_FranchiseDD').evaluate((node,value)=>{(node as HTMLSelectElement).value=value;},market);await postback(page,'ctl00$FranchiseDD');}
  const value=junkwareDate(date);await page.locator('#ctl00_Content_StartDateTB').fill(value);await page.locator('#ctl00_Content_EndDateTB').fill(value);
  await postback(page,'',{name:'ctl00$Content$SubmitBtn',value:'Submit'});
  if(await page.locator('#ctl00_Content_StartDateTB').inputValue()!==value||await page.locator('#ctl00_Content_EndDateTB').inputValue()!==value)throw new Error('JunkWare did not confirm the selected day.');
}
async function findEmployee(page:Page,name:string):Promise<string|null> {
  const hits:Array<{id:string;page:string}>=[];const pages=new Set<string>();
  if(await page.locator('[id$=CurrentPageLbl]').count()===0){if(await page.getByText('No records found.',{exact:false}).count())return null;throw new Error('JunkWare employee coverage is unavailable.');}
  for(let count=0;count<30;count++) {
    const current=await page.locator('[id$=CurrentPageLbl]').innerText();if(pages.has(current))throw new Error('JunkWare employee pagination did not advance.');pages.add(current);
    const rows=page.locator('tr[id^=ctl00_Content_ListView1_ctrl][id$=_ItemRow]');
    for(let i=0;i<await rows.count();i++){const row=rows.nth(i);if(normalizePayrollEmployeeKey(await row.locator('td').first().innerText())===normalizePayrollEmployeeKey(name))hits.push({id:await row.getAttribute('id')||'',page:current});}
    if(hits.length>1)throw new Error('More than one JunkWare employee matches this name.');
    const total=await page.locator('[id$=TotalPagesLbl]').innerText();if(current===total)break;
    if(count===29)throw new Error('JunkWare employee listing is incomplete.');
    const next=page.locator('[id$=NextPageBtn]');await postback(page,'',{name:(await next.getAttribute('name'))+'.x',value:'1'});
  }
  const hit=hits[0];if(!hit)return null;
  if(await page.locator('[id$=CurrentPageLbl]').innerText()!==hit.page){const first=page.locator('[id$=FirstPageBtn]');await postback(page,'',{name:(await first.getAttribute('name'))+'.x',value:'1'});for(let n=1;n<Number(hit.page);n++){const next=page.locator('[id$=NextPageBtn]');await postback(page,'',{name:(await next.getAttribute('name'))+'.x',value:'1'});}if(await page.locator('[id$=CurrentPageLbl]').innerText()!==hit.page)throw new Error('JunkWare employee page could not be restored.');}
  return hit.id;
}
export async function openEmployee(page:Page,correction:PayrollCorrection,known?:{employeeId:string;marketId:string}) {
  const markets=known?[known.marketId]:await page.locator('#ctl00_FranchiseDD option').evaluateAll(options=>options.map(o=>(o as HTMLOptionElement).value));
  const matches:Array<{employeeId:string;marketId:string}>=[];
  for(const marketId of markets) {
    await selectDay(page,correction.workDate,marketId);const row=await findEmployee(page,correction.employeeName);if(!row)continue;
    await linkPostback(page,`#${row.replace(/_ItemRow$/,'_EditButton')}`);
    const employeeId=await page.locator('[id$=_UserIDHF]').inputValue();if(!/^\d+$/.test(employeeId))throw new Error('JunkWare employee identity is unavailable.');
    if(known&&employeeId!==known.employeeId)throw new Error('The JunkWare employee identity changed.');
    matches.push({employeeId,marketId});
  }
  if(new Set(matches.map(m=>m.employeeId)).size!==1)throw new Error(matches.length?'Multiple JunkWare employees match this name.':'Employee not found in JunkWare.');
  const identity=matches[0];
  if(matches.length>1||await page.locator('[id$=_UserIDHF]').count()!==1||await page.locator('#ctl00_FranchiseDD').inputValue()!==identity.marketId){await selectDay(page,correction.workDate,identity.marketId);const row=await findEmployee(page,correction.employeeName);if(!row)throw new Error('JunkWare employee disappeared.');await linkPostback(page,`#${row.replace(/_ItemRow$/,'_EditButton')}`);}
  return identity;
}
export async function readShift(page:Page,date:string):Promise<{shift:JunkwareShift|null;rowId:string|null}> {
  const rows=page.locator('#time-entries tbody > tr[id$=_ItemRow]');
  const matches:Array<{shift:JunkwareShift;rowId:string}>=[];
  for(let i=0;i<await rows.count();i++){const row=rows.nth(i),cells=await row.locator(':scope > td').allTextContents();const shift=parseShift(cells.map(clean));if(shift.workDate===date)matches.push({shift,rowId:(await row.getAttribute('id'))!});}
  if(matches.length>1)throw new Error('This day has multiple JunkWare shifts. Edit the individual punches in JunkWare; a daily correction cannot safely replace them.');
  return matches[0]||{shift:null,rowId:null};
}
export async function prepareShift(page:Page,correction:PayrollCorrection,rowId:string|null,before:JunkwareShift|null=null) {
  const minutes=(clock:string)=>{const match=clock.match(/^(\d{2}):(\d{2}) (AM|PM)$/);if(!match)throw new Error('Enter valid shift times.');return Number(match[1])%12*60+Number(match[2])+(match[3]==='PM'?720:0);};
  if(correction.clockOut&&minutes(correction.clockOut)<=minutes(correction.clockIn))throw new Error('Use JunkWare to correct an overnight shift with its explicit clock-out date.');
  if(before?.clockOut&&minutes(before.clockOut)<=minutes(before.clockIn))throw new Error('The source shift spans midnight. Review its dates in JunkWare.');
  await linkPostback(page,rowId?`#${rowId.replace(/_ItemRow$/,'_EditButton')}`:'#time-entries [id$=_AddNewLink]');
  const date=junkwareDate(correction.workDate);
  if(before&&(sourceClock(await page.locator('#time-entries [id$=_TimeInTB]').inputValue())!==before.clockIn||sourceClock(await page.locator('#time-entries [id$=_TimeOutTB]').inputValue())!==before.clockOut||money(await page.locator('#time-entries [id$=_HourlyRateTB]').inputValue())!==before.hourlyRate))throw new Error('The JunkWare shift changed before saving. Refresh its current values.');
  if(rowId&&before?.clockOut&&await page.locator('#time-entries [id$=_DateOutTB]').inputValue()!==date)throw new Error('The source clock-out belongs to another date. Edit the overnight shift in JunkWare.');
  if(rowId){if(clean(await page.locator('#time-entries [id$=_WorkDateLbl]').innerText())!==date)throw new Error('JunkWare opened another work date.');}
  else await page.locator('#time-entries [id$=_WorkDateTB]').fill(date);
  await page.locator('#time-entries [id$=_TimeInTB]').fill(correction.clockIn);
  await page.locator('#time-entries [id$=_TimeOutTB]').fill(correction.clockOut);
  // The day editor represents one same-day shift. Existing overnight shifts are rejected by the runner.
  await page.locator('#time-entries [id$=_DateOutTB]').fill(correction.clockOut?date:'');
  await page.locator('#time-entries [id$=_HourlyRateTB]').fill(correction.hourlyRate.toFixed(2));
  return rowId?'#time-entries [id$=_UpdateButton]':'#time-entries [id$=_InsertButton]';
}
