import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {build} from 'esbuild';
import {chromium,webkit,expect} from '@playwright/test';
async function main(){
 const repo=process.cwd();const built=await build({stdin:{contents:`import React from 'react';import{createRoot}from'react-dom/client';import Search from './desktop-ui/live-search';import './desktop-ui/design-tokens.css';import './desktop-ui/approved-workbench.css';import './desktop-ui/css-phase-two.css';createRoot(document.getElementById('root')).render(<main className="ops-app ops-live"><section className="ops-content"><header className="topbar"><Search date="2026-09-08" finance disabled={new URLSearchParams(location.search).has('disabled')} navigate={()=>{throw Error('Should open a record, not a workspace')}}/></header></section></main>);`,resolveDir:repo,loader:'tsx'},bundle:true,write:false,outdir:'fixture',external:['/desktop-assets/*'],jsx:'automatic',alias:{'@/lib/utils':repo+'/desktop-ui/lib/utils','@':repo,react:repo+'/node_modules/react','react-dom':repo+'/node_modules/react-dom'},loader:{'.png':'dataurl','.svg':'dataurl'}});
 const js=built.outputFiles.find(f=>f.path.endsWith('.js'))!.text,css=built.outputFiles.find(f=>f.path.endsWith('.css'))!.text;let writes=0;
 const job=(id:string,jk='JK1000123',date='2026-09-09')=>({id:`job:${date}:${id}`,type:'job',title:`Sample Customer · ${jk}`,subtitle:date+' · 100 Example St',source:'Synthetic appointment',href:`/jobs?date=${date}&appointment=${id}&q=${jk}`});
 const customer=(id:string)=>({id:`customer:${id}`,type:'customer',title:'Sample Customer',subtitle:'100 Example St · 2 appointments',source:'Synthetic customer account',href:`/desktop?workspace=Schedule&scheduleView=customers&customer=${id}&date=2026-09-09`});
 const server=createServer(async(req,res)=>{if(req.method!=='GET'){writes++;res.writeHead(400);res.end('{}');return;}const url=new URL(req.url||'/', 'http://fixture');const q=url.searchParams.get('q')||'';
 if(url.pathname==='/api/global-search'){
  const history=url.searchParams.get('source')==='junkware';await new Promise(r=>setTimeout(r,q==='JK1000555'?400:100));
  if(q==='JK1000999'){res.writeHead(503,{'Content-Type':'application/json'});res.end('{"error":"Search unavailable"}');return;}
  let rows:any[]=[];
  if(q==='JK1000123')rows=history?[job('123')]:[customer('500'),job('999','JK1000998'),job('123','JK1000123','2026-09-08')];
  if(q==='JK1000222')rows=[job('222','JK1000222'),job('223','JK1000222')];
  if(q==='Sample Customer')rows=[customer('500'),job('123')];
  if(q==='Ambiguous')rows=[{...customer('500'),title:'Ambiguous'},{...customer('501'),title:'Ambiguous'}];
  if(q==='100 Example St')rows=[job('123'),job('124','JK1000124','2025-11-11')];
  if(q==='JK1000555')rows=[job('555','JK1000555')];
  res.setHeader('Content-Type','application/json');res.end(JSON.stringify({results:rows,customerTotal:rows.filter(r=>r.type==='customer').length,appointmentTotal:rows.filter(r=>r.type==='job').length,checkedAt:history?'2026-09-08T12:00:00Z':undefined,hasMore:false}));return;
 }
 if(url.pathname.startsWith('/api/')){res.setHeader('Content-Type','application/json');res.end(JSON.stringify(url.pathname.includes('ask-opsbot')?{available:true,remaining:50,limit:50}:{answer:null}));return;}
 if(url.pathname==='/app.js'){res.setHeader('Content-Type','text/javascript');res.end(js);return;}
 if(url.pathname.startsWith('/desktop-assets/')){res.writeHead(404);res.end();return;}
 res.setHeader('Content-Type','text/html');if(url.pathname==='/desktop'){res.end('<h1>Synthetic record destination</h1>');return;}
 res.end(`<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><style>*{box-sizing:border-box}body{margin:12px;font:16px system-ui}${css}</style><div id="root"></div><script src="/app.js"></script>`);
 });await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));const origin=`http://127.0.0.1:${(server.address() as {port:number}).port}`;
 try{for(const engine of [chromium,webkit]){const browser=await engine.launch({headless:true});try{for(const width of [390,844]){const page=await browser.newPage({viewport:{width,height:844},isMobile:true,hasTouch:true});const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));await page.route('**/*',r=>r.request().url().startsWith(origin)?r.continue():r.abort());await page.goto(origin);const search=page.getByRole('textbox',{name:'Ask OpsBot or search records'});
 await search.fill('JK1000123');await search.press('Enter');await page.waitForURL('**/desktop?**');let target=new URL(page.url());assert.equal(target.searchParams.get('appointment'),'123');assert.equal(target.searchParams.get('date'),'2026-09-09','Live history replaces old date; never opens first unrelated result');
 await page.goBack();await expect(search).toBeVisible();await search.fill('JK1000222');await search.press('Enter');await expect(page.getByText('Choose the matching record below.',{exact:true})).toBeVisible();assert.equal(new URL(page.url()).pathname,'/');
 await search.fill('Sample Customer');await search.press('Enter');await page.waitForURL('**/desktop?**');target=new URL(page.url());assert.equal(target.searchParams.get('customer'),'500');assert.equal(target.searchParams.get('scheduleView'),'customers');
 await page.goto(origin);await search.fill('Ambiguous');await search.press('Enter');await expect(page.getByText('Choose the matching record below.',{exact:true})).toBeVisible();await expect(page.getByRole('region',{name:'Customers'}).getByRole('button')).toHaveCount(2);
 await search.fill('100 Example St');await expect(page.getByRole('button',{name:/JK1000124/})).toBeVisible();await page.getByRole('button',{name:/JK1000124/}).tap();await page.waitForURL('**/desktop?**');target=new URL(page.url());assert.equal(target.searchParams.get('appointment'),'124');assert.equal(target.searchParams.get('date'),'2025-11-11');
 await page.goto(origin);await search.fill('JK1000999');await search.press('Enter');await expect(page.getByText('Search is incomplete. Choose a verified result below or retry.',{exact:true})).toBeVisible();assert.equal(new URL(page.url()).pathname,'/');
 await search.fill('JK1000888');await search.press('Enter');await expect(page.getByText('No exact record found. Check the identifier or choose another search.',{exact:true})).toBeVisible();
 await search.fill('JK1000555');await search.press('Enter');await search.fill('Ambiguous');await expect(page.getByRole('region',{name:'Customers'}).getByRole('button')).toHaveCount(2);await page.waitForTimeout(1400);assert.equal(new URL(page.url()).pathname,'/','Changed query cancels pending launch');
 await search.fill('JK1000555');await search.press('Enter');await search.press('Escape');await page.waitForTimeout(1400);assert.equal(new URL(page.url()).pathname,'/','Dismissal cancels pending launch');
 await page.goto(origin+'/?disabled');await expect(search).toBeDisabled();assert.deepEqual(errors,[]);await page.close();console.log(`PASS ${engine.name()} ${width}px: early Enter, exact dated JK, customer account, ambiguous choices, address tap, history, failures, stale/cancel, back, disabled; no writes/AI calls`);
 }}finally{await browser.close();}}assert.equal(writes,0);}finally{server.close();}
}
void main().catch(e=>{console.error(e);process.exitCode=1;});
