import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {build} from 'esbuild';
import {chromium,webkit,expect} from '@playwright/test';
const field=(value='',label='',options=[{value:'',label:''}])=>({value,label,options});
const fixture={photoEvidence:{appointmentId:'1234',urls:['https://junkware.junk-king.com/system/aspnet/local/media/before-1234-test.jpg']},truck:'Truck 1',truckOptions:[{value:'t',label:'Truck# 1'},{value:'u',label:'Truck# 6'}],status:field('1','Confirmed'),appointmentType:field('2','Job'),driver:{value:'d',label:'Fixture Driver'},drivers:[{value:'d',label:'Fixture Driver'}],navigators:[],navigatorOptions:[],loadQuantity:'1',loadSize:field(),loadPrices:[],loadPrice:'1200',bedloadQuantity:'',bedloadSize:field(),bedloadPrices:[],bedloadPrice:'',otherChargeOptions:[],otherCharges:[],discount:'',tip:'',jobCategory:field(),howHeard:field('ref','Referral',[{value:'ref',label:'Referral'}]),actualStartHour:field('12','12 PM',[{value:'12',label:'12 PM'}]),actualStartMinute:field('00','00',[{value:'00',label:'00'}]),actualEndHour:field('13','1 PM',[{value:'13',label:'1 PM'}]),actualEndMinute:field('00','00',[{value:'00',label:'00'}]),paymentMethods:[{value:'1',label:'Billed'},{value:'2',label:'Cash'},{value:'3',label:'Credit Card'},{value:'4',label:'Check'}],payments:[],balance:'1200.00',total:'$1,200.00'};
async function main(){
 const built=await build({stdin:{contents:`import React from 'react';import{createRoot}from'react-dom/client';import Closeout from './desktop-ui/appointment-closeout';import Legacy from './components/JobCloseoutEditor';import Booking from './app/crew-jobs/manager-booking';import Edit from './app/crew-jobs/manager-edit';import Creation from './desktop-ui/appointment-creation';
 const view=new URLSearchParams(location.search).get('view');const job={recordId:'sample',appointmentId:'1234',appointmentUrl:'https://example.invalid/1234',status:'Confirmed',appointmentType:'Job',truck:'Truck 1',version:'source',jkNumber:'SAMPLE'};
 const transport=view==='waypoint'?{load:async()=>await(await fetch('/api/desktop/schedule/closeout')).json(),send:async()=>{throw Error('No writes allowed');},check:async()=>{throw Error('No saved result lookup');}}:undefined;
 createRoot(document.getElementById('root')).render(view==='booking'?<Booking date="2026-10-28" trucks={['Truck 1']} onClose={()=>{}} onSaved={()=>{}}/>:view==='edit'?<Edit job={job} date="2026-10-28" receipt={null} onReceipt={()=>{}} onClose={()=>{}}/>:view==='creation'?<Creation date="2026-10-28" close={()=>{}} saved={()=>{}} onBusyChange={()=>{}}/>:view==='legacy'?<Legacy appointmentId="1234" appointmentUrl="https://example.invalid/1234" initialStatus="Confirmed" serviceDate="2026-10-28"/>:<Closeout job={job} date="2026-10-28" saved={()=>{}} onBusyChange={()=>{}} transport={transport}/>);`,resolveDir:process.cwd(),loader:'tsx'},bundle:true,write:false,outdir:'fixture',jsx:'automatic',alias:{react:process.cwd()+'/desktop-ui/node_modules/react','react-dom':process.cwd()+'/desktop-ui/node_modules/react-dom'},plugins:[{name:'mock-router',setup(b){b.onResolve({filter:/^next\/navigation$/},()=>({path:'router',namespace:'mock'}));b.onLoad({filter:/.*/,namespace:'mock'},()=>({contents:'export const useRouter=()=>({refresh(){throw Error("No save allowed")}});',loader:'js'}));}}]});
 const js=built.outputFiles.find(f=>f.path.endsWith('.js'))!.text,css=built.outputFiles.find(f=>f.path.endsWith('.css'))!.text;
 let writes=0;
 const server=createServer((req,res)=>{
  if(req.method!=='GET'){writes++;res.writeHead(400);res.end('{}');return;}
  if(req.url?.startsWith('/api/')){res.setHeader('Content-Type','application/json');res.end(JSON.stringify({closeout:fixture,sourceVersion:'a'.repeat(64),canWrite:true}));return;}
  if(req.url==='/app.js'){res.setHeader('Content-Type','text/javascript');res.end(js);return;}
  res.setHeader('Content-Type','text/html');res.end(`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{font:16px system-ui;max-width:600px;margin:16px}input{max-width:100%;box-sizing:border-box}${css}</style><div id="root"></div><script src="/app.js"></script>`);
 });
 await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));const origin=`http://127.0.0.1:${(server.address() as {port:number}).port}`;
 try{for(const engine of [chromium,webkit]){
  const browser=await engine.launch({headless:true});try{
  for(const width of [390,844]){
   const page=await browser.newPage({viewport:{width,height:844},isMobile:true,hasTouch:true});const errors:string[]=[];page.on('pageerror',e=>{errors.push(e.message);console.error(e.message);});
   await page.route('**/*',route=>route.request().url().startsWith(origin)?route.continue():route.abort());
   for(const view of ['closeout','waypoint','legacy']){
    console.log('Checking',engine.name(),width,view);await page.goto(origin+'/?view='+view);await page.locator('summary').click();if(view==='legacy')await page.getByRole('button',{name:'Open JunkWare closeout',exact:true}).click();
    await page.getByRole('checkbox',{name:view==='waypoint'?'Record payment or Billed':'Add a payment',exact:true}).check();
    const select=async(label:string)=>{if(view==='legacy')await page.getByRole('combobox',{name:'Payment method',exact:true}).selectOption({label});else await page.getByRole('radio',{name:label,exact:true}).check();};
    await select('Credit Card');const ref=page.getByRole('textbox',{name:'Card last four',exact:true});await expect(ref).toHaveAttribute('inputmode','numeric');await ref.tap();await ref.fill('0012');await expect(ref).toHaveValue('0012');assert.equal(await ref.evaluate(e=>(e as HTMLInputElement).type),'text');await expect(ref).toHaveAttribute('maxlength','4');
    const amount=page.getByRole('textbox',{name:'Payment amount',exact:true});await expect(amount).toHaveAttribute('inputmode','decimal');await amount.fill('306.94');await expect(amount).toHaveValue('306.94');
    for(const label of ['Load price','Bedload price','Discount','Tip']){const input=page.getByRole('textbox',{name:label,exact:true});await expect(input).toHaveAttribute('inputmode','decimal');}
    await select('Check');const check=page.getByRole('textbox',{name:'Check number',exact:true});await expect(check).toHaveAttribute('inputmode','text');await check.fill('AB-0012');await expect(check).toHaveValue('AB-0012');
    await select('Credit Card');await expect(ref).toHaveValue('');await ref.fill('0007');await expect(ref).toHaveValue('0007');
   }
   await page.goto(origin+'/?view=edit');
   for(const label of ['load Quantity','load Price','bedload Quantity','bedload Price','discount','tip']){const input=page.getByRole('spinbutton',{name:label,exact:true});await expect(input).toHaveAttribute('inputmode','decimal');await input.fill('1.25');await expect(input).toHaveValue('1.25');}
   await page.goto(origin+'/?view=booking');await expect(page.getByLabel('Duration hours')).toHaveAttribute('inputmode','numeric');await expect(page.getByLabel('Customer phone',{exact:true})).toHaveAttribute('inputmode','tel');const zip=page.getByLabel('Service ZIP',{exact:true});await expect(zip).toHaveAttribute('inputmode','numeric');await zip.fill('00123');await expect(zip).toHaveValue('00123');await zip.fill('00123-4567');await expect(zip).toHaveValue('00123-4567');
   await page.goto(origin+'/?view=creation');const opsZip=page.getByLabel('ZIP *',{exact:true});await expect(opsZip).toHaveAttribute('inputmode','numeric');await opsZip.fill('00123');await expect(opsZip).toHaveValue('00123');await expect(page.getByLabel('Phone *',{exact:true})).toHaveAttribute('inputmode','tel');await expect(page.getByLabel('Contact phone',{exact:true})).toHaveAttribute('inputmode','tel');await page.getByLabel('Billing address matches service address').uncheck();await expect(page.getByLabel('Billing ZIP *',{exact:true})).toHaveAttribute('inputmode','numeric');
   assert.equal(writes,0);assert.deepEqual(errors,[]);await page.close();console.log(`PASS ${engine.name()} ${width}px: closeout variants, decimal charges, numeric card/ZIP/duration, telephone modes, leading zeros, ZIP+4 and alphanumeric checks preserved; no writes`);
  }}finally{await browser.close();}
 }}finally{server.close();}
}
main().catch(error=>{console.error(error);process.exitCode=1;});
