import fs from 'node:fs';
import path from 'node:path';
import { chromium, type Page } from '@playwright/test';
import { ensureAuthenticated } from './reschedule-junkware-appointment';
import { clickWithWebFormsCompletion } from './junkware-webforms';
import { historyQuery, historyDate, historyDateBounds, historyResult, type HistorySearch } from '../lib/junkware-history-contract';
import type { AppointmentSearchScope } from '../lib/global-search';

const prefix='#ctl00_Content_';
const pager=prefix+'ListView1_DataPager1_ctl00_';
export async function searchHistoryOnPage(page:Page, query:string, scope:AppointmentSearchScope, today:string, click=clickWithWebFormsCompletion):Promise<HistorySearch> {
  const search=historyQuery(query);
  if (!search) throw new Error('Unsupported history query');
  // Clear all search restrictions, including status: completed jobs must be discoverable.
  const bounds=historyDateBounds(scope,today);
  const fields=['StartDateTB','EndDateTB','AppointmentCodeTB','FirstNameTB','LastNameTB','CompanyTB','EmailTB','PhoneTB','AddressTB','CheckNoTB','FUStartDateTB','FUEndDateTB','PONumberTB'];
  const values:Record<string,string>={StartDateTB:bounds.start,EndDateTB:bounds.end,[search.field]:search.value};
  for(const field of fields)await page.locator(prefix+field).fill(values[field]||'');
  for(const field of ['AppointmentTypeDD','StatusDD','FranchiseDD'])await page.locator(prefix+field).selectOption('');
  const markets=await page.locator(prefix+'FranchiseDD option').evaluateAll(nodes=>nodes.map(node=>(node as HTMLOptionElement).value));
  if(!['352','477','399','484'].every(id=>markets.includes(id)))throw new Error('Incomplete franchise access');
  await click(page,prefix+'SubmitBtn','the appointment history search');
  const results:HistorySearch['results']=[];
  const seen=new Set<string>();
  for(let pageNumber=1;pageNumber<=5;pageNumber++){
    // Validate retained filters after every postback before trusting an empty or partial result.
    for(const field of fields)if(await page.locator(prefix+field).inputValue()!==(values[field]||''))throw new Error('Search restrictions changed');
    for(const field of ['AppointmentTypeDD','StatusDD','FranchiseDD'])if(await page.locator(prefix+field).inputValue()!=='')throw new Error('Search restrictions changed');
    const rows=await page.locator("tr[id^='ctl00_Content_ListView1_ctrl'][id$='_ItemRow']").evaluateAll(nodes=>nodes.map(node=>{
      const cells=Array.from(node.querySelectorAll('td'));
      const text=(n:Element|undefined)=>(n as HTMLElement|undefined)?.innerText?.replace(/\s+/g,' ').trim()||'';
      const customer=cells[3];
      const name=customer?Array.from(customer.childNodes).filter(n=>n.nodeType===3).map(n=>n.textContent||'').join(' ').replace(/\s+/g,' ').trim().replace(/,$/,''):'';
      return {appointmentId:node.getAttribute('onclick')?.match(/window\.location\s*=\s*['"]appointment\.aspx\?id=(\d+)['"]/i)?.[1]||'',date:text(cells[0]),time:text(cells[1]),jk:text(cells[2]).match(/JK\d+/i)?.[0]?.toUpperCase()||'',type:text(cells[2]).replace(/JK\d+/i,'').trim(),name,address:text(customer?.querySelector('a[href*="maps"]')||undefined),phone:text(customer?.querySelector('a[href^="tel:"]')||undefined),status:text(cells[6]),cellCount:cells.length};
    }));
    if(!rows.length){
      if(pageNumber===1&&await page.getByText('No results found.',{exact:true}).isVisible())return {results:[],hasMore:false,checkedAt:new Date().toISOString()};
      throw new Error('Unrecognized history response');
    }
    const current=Number(await page.locator(pager+'CurrentPageLbl').textContent());
    const pages=Number(await page.locator(pager+'TotalPagesLbl').textContent());
    if(current!==pageNumber||!Number.isSafeInteger(pages)||pages<current)throw new Error('Invalid source pagination');
    for(const row of rows){
      if(row.cellCount!==7||seen.has(row.appointmentId))throw new Error('Invalid source row');
      seen.add(row.appointmentId);
      const result=historyResult({...row,date:historyDate(row.date)});
      if(scope!=='all'&&(scope==='past'?result.appointmentDate!>=today:result.appointmentDate!<today))throw new Error('Source date filter failed');
      if(results.length<100)results.push(result);
    }
    if(current===pages||results.length>=100||pageNumber===5)return {results,hasMore:current<pages||seen.size>100,checkedAt:new Date().toISOString()};
    await click(page,pager+'NextPageBtn','the next history results page');
  }
  throw new Error('History page limit');
}
async function main(){
  let input='';for await(const chunk of process.stdin){input+=chunk;if(input.length>2048)throw new Error('Input too large');}
  const {query,scope,today}=JSON.parse(input);
  if(typeof query!=='string'||!historyQuery(query)||!['all','past','upcoming'].includes(scope)||!/^\d{4}-\d{2}-\d{2}$/.test(today))throw new Error('Invalid history request');
  const storage=path.join(process.env.OPSBOT_DATA_DIR||path.join(process.env.HOME||'','.openclaw/workspace/opsbot/data'),'protected/junkware_storage_state.json');
  const browser=await chromium.launch({headless:true});
  const stop=()=>{void browser.close().finally(()=>process.exit(1));};
  process.once('SIGTERM',stop);
  try{
    const context=await browser.newContext(fs.existsSync(storage)?{storageState:storage}:{});
    const page=await context.newPage();page.setDefaultTimeout(15000);
    await ensureAuthenticated(page,'https://junkware.junk-king.com/franchise/search.aspx');
    process.stdout.write(JSON.stringify(await searchHistoryOnPage(page,query,scope,today)));
  }finally{process.off('SIGTERM',stop);await browser.close();}
}
if(process.argv[1]?.endsWith('search-junkware-history.ts'))main().catch(()=>{process.stderr.write('History search unavailable\n');process.exitCode=1;});
