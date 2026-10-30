import assert from 'node:assert/strict';
import vm from 'node:vm';
import type {Page} from '@playwright/test';
import {searchHistoryOnPage} from './search-junkware-history';

// Minimal DOM-shaped source pages exercise the actual extraction callback without
// a browser, credentials, network access, or copying any real customer records.
function row(id:number,date='11/11/2025'){
 const cells=[date,'02:00 PM - 03:00 PM',`JK${1000000+id}\nJob`,'Example Customer,\n5045550100\n100 Example Road\nNew Orleans, LA 70127','Check','$500.00','Completed'].map(innerText=>({innerText,childNodes:[] as Array<{nodeType:number;textContent:string}>,querySelector:(_s:string):{innerText:string}|null=>null}));
 cells[3].childNodes=[{nodeType:3,textContent:'Example Customer, '},{nodeType:1,textContent:'5045550100'}];
 cells[3].querySelector=(s:string)=>s.includes('maps')?{innerText:'100 Example Road\nNew Orleans, LA 70127'}:{innerText:'5045550100'};
 return {querySelectorAll:()=>cells,getAttribute:()=>`window.location='appointment.aspx?id=${id}';`};
}
function source(pages:ReturnType<typeof row>[][],options:{empty?:boolean;wrongPage?:boolean;markets?:string[];alterFilters?:boolean}={}){
 const values=new Map<string,string>();let current=0;const clicks:string[]=[];
 const page={
  locator:(selector:string)=>({
   fill:async(value:string)=>{values.set(selector,value);},selectOption:async(value:string)=>{values.set(selector,value);},
   inputValue:async()=>values.get(selector)||'',
   textContent:async()=>String(selector.endsWith('CurrentPageLbl')?(options.wrongPage?1:current+1):pages.length),
   evaluateAll:async(callback:(nodes:unknown[])=>unknown)=>vm.runInNewContext('('+callback.toString()+')(nodes)',{nodes:selector.includes(' option')?(options.markets||['352','477','399','484']).map(value=>({value})):pages[current]}),
  }),
  getByText:()=>({isVisible:async()=>Boolean(options.empty)}),
 } as unknown as Page;
 const click=async(_p:Page,selector:string)=>{
  clicks.push(selector);
  if(selector.endsWith('NextPageBtn'))current++;
  else if(!selector.endsWith('SubmitBtn'))throw Error('Unexpected source mutation');
  if(options.alterFilters)values.set('#ctl00_Content_StatusDD','Confirmed');
 };
 return {page,click,values,clicks};
}
async function main(){
 const first=source([[row(10001)],[row(10002,'11/10/2025')]]);
 const result=await searchHistoryOnPage(first.page,'100 Example','all','2026-10-27',first.click);
 assert.equal(result.results.length,2);assert.equal(result.hasMore,false);assert.equal(result.results[0].title,'Example Customer · JK1010001');assert.match(result.results[0].subtitle,/Completed · 100 Example Road New Orleans/);
 assert.equal(first.values.get('#ctl00_Content_StartDateTB'),'');assert.equal(first.values.get('#ctl00_Content_EndDateTB'),'');assert.equal(first.values.get('#ctl00_Content_StatusDD'),'');assert.equal(first.values.get('#ctl00_Content_FranchiseDD'),'');
 assert.equal(first.clicks.length,2);assert.ok(first.clicks.every(s=>/SubmitBtn|NextPageBtn/.test(s)));
 const past=source([[row(10001)]]);await searchHistoryOnPage(past.page,'100 Example','past','2026-10-27',past.click);assert.equal(past.values.get('#ctl00_Content_EndDateTB'),'10/26/2026');
 const wrongDate=source([[row(10001,'10/27/2026')]]);await assert.rejects(searchHistoryOnPage(wrongDate.page,'100 Example','past','2026-10-27',wrongDate.click),/filter failed/);
 const many=source([Array.from({length:90},(_,i)=>row(1000+i)),Array.from({length:20},(_,i)=>row(2000+i))]);const capped=await searchHistoryOnPage(many.page,'100 Example','all','2026-10-27',many.click);assert.equal(capped.results.length,100);assert.equal(capped.hasMore,true);
 const empty=source([[]],{empty:true});assert.deepEqual((await searchHistoryOnPage(empty.page,'100 Example','all','2026-10-27',empty.click)).results,[]);
 for(const broken of [source([[]]),source([[row(1)],[row(2)]],{wrongPage:true}),source([[row(1)],[row(1)]]),source([[row(1)]],{markets:['352']}),source([[]],{empty:true,alterFilters:true})])await assert.rejects(searchHistoryOnPage(broken.page,'100 Example','all','2026-10-27',broken.click));
 console.log('PASS: actual source row extraction, completed records, all-market/unrestricted-date filters, Past cutoff, pagination/cap, confirmed empty state, changed filters, malformed/duplicate pages and missing markets. Offline fixtures only.');
}
void main().catch(error=>{console.error(error);process.exitCode=1;});
