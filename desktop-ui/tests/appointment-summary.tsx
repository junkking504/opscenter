import {useEffect,useState} from 'react';
import {useDisplayedRefresh} from '../displayed-refresh';
import {createRoot} from 'react-dom/client';
import LiveSchedule from '../live-schedule';
import type {ScheduleAppointment} from '../lib/schedule-contract';
import '../app/globals.css';
import '../live-responsive.css';
import '../workspace-density.css';
import '../opscenter-brand.css';
import '../approved-workbench.css';
import '../theme.css';

// Synthetic records only. Fetch never reaches a server, and every write is denied.
const date='2026-10-25';
const scenario=new URLSearchParams(location.search).get('case')||'long';
const fixtureView=new URLSearchParams(location.search).get('view');
const view=fixtureView==='history'||fixtureView==='followup'||fixtureView==='calendar'?fixtureView:'board';
const calls:Array<{path:string;search:string;method:string}>=[];
(window as unknown as {summaryFixtureCalls:typeof calls}).summaryFixtureCalls=calls;
window.EventSource=class extends EventTarget {close(){}} as unknown as typeof EventSource;
const job:ScheduleAppointment={recordId:date+':appointment:999001',appointmentId:'999001',version:'a'.repeat(64),callAhead:'not_called',jkNumber:'JKSYNTHETIC',appointmentUrl:'',appointmentTime:'9:00 AM–10:00 AM',appointmentStartMinutes:540,appointmentEndMinutes:600,hasScheduledTime:true,customerName:'Synthetic Customer With An Intentionally Long Display Name For Phone Wrapping',customerEmail:'',phone:'(555) 010-1001',address:'100 Example Boulevard, Building Three, Second Floor, Suite 237, New Orleans, LA 70130',territory:'New Orleans',appointmentType:'Job',status:'Confirmed',truck:'Truck 4',driver:'Synthetic Driver',navigator:'Synthetic Navigator',paymentType:'',paymentAmount:0,tipAmount:0,junkItems:['Use the side entrance. Sofa, mattress, bookcases, and boxes stored in the upstairs room. Additional oversized synthetic request text deliberately exceeds the compact summary limit so the complete source request remains available behind the notes disclosure.'],appointmentNotes:['Use the side entrance. Call before arrival.','Additional source history remains in full details.'],cancellationReason:'',location:null,addressCheckReason:'No exact building match',onsiteTime:{minutes:null,arrival:null,departure:null,label:'Unavailable · no confirmed visit'}};
if(scenario==='missing'){job.customerName='';job.address='';job.phone='';job.driver='';job.navigator='';job.junkItems=[];job.appointmentNotes=[];job.appointmentTime='';job.appointmentStartMinutes=null;job.appointmentEndMinutes=null;job.hasScheduledTime=false;job.addressCheckReason='Address unavailable';job.chargeDetailsPending=true;}
if(scenario==='warning'){job.junkwareSyncStatus='manual_correction';job.junkwareSyncError='Synthetic source assignment needs verification.';job.status='Completed';job.closeout={total:0,tip:0,balance:0,payments:[]};}
if(scenario==='long')job.cancellationReason='Cancellation reason unavailable';
if(scenario==='details'){job.appointmentType='Estimate';job.customerName='Synthetic Detailed Request';job.cancellationReason='Cancellation reason unavailable';job.junkItems=['Construction debris','Tires'];job.appointmentNotes=['Note: Customer will be absent; call with a quote. Disposing about 5 items like 4 broken stone panels, 80 to 95 lbs each, and a tire filled with sand. (10/20/2026 9:00:00 PM , Customer)'];}
if(view==='followup')job.appointmentType='Estimate';
let recordPresent=true;
window.fetch=async(input,init)=>{
 const request=input instanceof Request?input:null;
 const url=new URL(request?.url||String(input),location.origin),method=init?.method||request?.method||'GET';
 calls.push({path:url.pathname,search:url.search,method});
 if(method!=='GET')return Response.json({error:'Writes disabled in synthetic summary fixture'},{status:403});
 if(url.pathname==='/api/desktop/schedule')return Response.json({date,observedAt:date+'T14:00:00Z',sourceRequest:{state:'ready'},appointments:recordPresent?[job]:[],operationalStops:[],fleet:{isToday:false,lastUpdatedAt:null,trucks:[]}});
 if(url.pathname==='/api/desktop/schedule/history')return Response.json({coverage:'Synthetic history',rows:[{id:'synthetic-event',at:date+'T14:00:00Z',appointmentId:job.appointmentId,action:'assignment',actor:'Synthetic actor',status:'verified',detail:'Synthetic history row'}]});
 if(url.pathname==='/api/desktop/schedule/routes')return Response.json({date,legs:[],closest:[],appointmentId:null});
 return Response.json({error:'Source disabled in synthetic summary fixture'},{status:503});
};
function Fixture(){const [day,setDay]=useState('today');const refresh=useDisplayedRefresh('Schedule');useEffect(()=>{(window as unknown as {summaryFixtureRefresh:(present:boolean)=>Promise<void>|undefined}).summaryFixtureRefresh=present=>{recordPresent=present;return refresh?.();};},[refresh]);return <main className="ops-app ops-live" style={{display:'block',padding:12}}><div className="ops-content"><h1>Synthetic appointment summary</h1><LiveSchedule view={view} baseDate={date} day={day} onDayChange={setDay} report={()=>{}}/></div></main>;}
createRoot(document.getElementById('root')!).render(<Fixture/>);
