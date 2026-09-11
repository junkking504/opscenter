import {useEffect,useState} from 'react';
import {createRoot} from 'react-dom/client';
import LiveSchedule from '../live-schedule';
import type {ScheduleAppointment} from '../lib/schedule-contract';
import '../app/globals.css';
import '../live-responsive.css';
import '../workspace-density.css';

// Every request and move is synthetic and stays in memory in this browser tab.
const scenario=new URLSearchParams(location.search).get('scenario') || 'unassigned';
const progressEnabled=new URLSearchParams(location.search).has('progress');
let progressStage='approaching';
const progressGps=()=>new Date(Date.now()-(progressStage==='parked'?1800000:progressStage==='parked-overdue'?4800000:progressStage==='stale'?300000:20000)).toISOString();
const stalePresence=new URLSearchParams(location.search).get('presence')==='stale';
const result=new URLSearchParams(location.search).get('result') || 'verified';
const longDetails=new URLSearchParams(location.search).get('details')==='long';
const routeMode=new URLSearchParams(location.search).get('routes') || 'available';
const areaCases=new URLSearchParams(location.search).has('areas') ? [
  ['New Orleans, LA 70114','Jefferson Parish'], ['Westwego, LA 70094','New Orleans'],
  ['New Orleans, LA 70128','New Orleans'], ['Chalmette, LA 70043','Jefferson Parish'],
  ['Metairie, LA 70001','Jefferson Parish'], ['New Orleans, LA 70122','New Orleans'],
  ['New Orleans, LA 70114','Jefferson Parish'], ['New Orleans, LA 70128','New Orleans'],
] : null;
let releaseVerification:(()=>void)|undefined;
const assignments=new Map<string,string>();
const cancellations=new Set<string>();
const writes:Array<{date:string;recordId:string;action:string;values:{truck:string}}>=[];
function appointments(date:string):ScheduleAppointment[] {
  return Array.from({length:areaCases?.length ?? (scenario==='empty'?0:scenario==='dense'?24:scenario==='same-time'?4:['on-site','route-stack'].includes(scenario)?3:1)},(_,index)=>{
    const recordId=`${date}:appointment:${1001+index}`;
    return {recordId,appointmentId:String(1001+index),version:'a'.repeat(64),callAhead:'not_called',jkNumber:`JK100${String(1001+index)}`,appointmentUrl:'',appointmentTime:'9:00 AM–10:00 AM',appointmentStartMinutes:540,appointmentEndMinutes:600,hasScheduledTime:true,customerName:`Example appointment ${index+1}`,customerEmail:'',phone:'',address:'',territory:'Baton Rouge',appointmentType:'Job',status:'Confirmed',truck:assignments.get(recordId)||'Virtual Truck',driver:'',navigator:'',paymentType:'',paymentAmount:0,tipAmount:0,junkItems:[],appointmentNotes:[],cancellationReason:'',location:null};
  }).map((job,index)=>areaCases?{...job,address:`100 Example Rd ${areaCases[index][0]}`,territory:areaCases[index][1],location:{latitude:29.9+index*.035,longitude:-90.1},status:index===6?'Canceled':index===7?'Completed':'Confirmed'}:job)
    .map(job=>scenario==='completed'?{...job,status:'Completed',truck:'Truck 8'}:job)
    .map(job=>scenario==='canceled'?{...job,status:'Canceled'}:job)
    .map(job=>cancellations.has(job.recordId)?{...job,status:'Canceled'}:job)
    .map(job=>scenario==='same-time'?{...job,truck:'Truck 8',appointmentTime:'8:00 AM–9:00 AM',appointmentStartMinutes:480,appointmentEndMinutes:540}:job)
    .map((job,index)=>scenario==='route-stack'?{...job,truck:'Truck 9',status:index===0?'Completed':'Confirmed',stopOrder:index,...(progressEnabled?{location:{latitude:30,longitude:-90},truckOnSite:index===1&&progressStage==='onsite',onsiteTruck:index===1&&progressStage==='onsite'?'Truck 9':undefined,onsiteTime:index===0?{minutes:20,arrival:new Date(Date.now()-3600000).toISOString(),departure:new Date(Date.now()-1200000).toISOString(),label:'20 min'}:undefined}:{}),appointmentStartMinutes:index===0?540:660,appointmentEndMinutes:index===0?600:720,appointmentTime:index===0?'9:00 AM–10:00 AM':'11:00 AM–12:00 PM'}:job)
    .map((job,index)=>scenario==='on-site'?{...job,truck:'Truck 8',address:'100 Example St Baton Rouge LA 70802',location:{latitude:30.45+index*.04,longitude:-91.18},truckOnSite:index<2 && !stalePresence,lastSeenOnsiteTruck:stalePresence && index===0?'Truck 8':undefined,lastSeenOnsiteAt:stalePresence?'2026-09-08T14:30:00Z':undefined,status:index===1?'Completed':'Confirmed'}:job)
    .map(job=>longDetails?{...job,address:'100 Example Boulevard, Building Three, Second Floor, Suite 237, New Orleans, LA 70130',junkItems:['Sofa, mattress, bookcases, and boxes stored in the upstairs room; use the side entrance.'],phone:'(555) 010-1001',appointmentNotes:['Use the side entrance. Call before arrival.','Additional source history remains in full details.'],location:routeMode==='address'?null:{latitude:30,longitude:-90}}:job);
}
window.fetch=async(input,init)=>{
  const url=new URL(String(input),location.origin),date=url.searchParams.get('date') || '2026-09-08';
  if(url.pathname==='/api/desktop/schedule/gps') {
    const coords=[{latitude:30.45,longitude:-91.18,address:'100 Example St, Baton Rouge'},{latitude:30.49,longitude:-91.18,address:'200 Example Ave, Baton Rouge'},{latitude:30.53,longitude:-91.18,address:'300 Example Rd, Baton Rouge'}];
    const points=coords.map((p,i)=>({...p,timestamp:`${date}T${13+i}:00:00.000Z`}));
    return Response.json({date,truck:'Truck 8',sourceVersion:'fixture',status:'available',observedAt:null,points,paths:[],gaps:0,rejected:0,trips:[0,1].map(i=>({id:`trip-${i+1}`,number:i+1,from:coords[i],to:coords[i+1],departure:points[i].timestamp,arrival:points[i+1].timestamp}))});
  }
  if(url.pathname==='/api/desktop/schedule/gps/streets') return Response.json({sourceVersion:'fixture',status:'unavailable',paths:[],unmatched:0});
  if(url.pathname==='/api/fleet-location-address') return Response.json({address:'100 Example St, Baton Rouge, Louisiana, 70802'});
  if(init?.method==='POST') {
    if(url.pathname==='/api/desktop/schedule/order' && JSON.parse(String(init.body)).action==='preview') return Response.json({ids:JSON.parse(String(init.body)).ids,legs:[]});
    if(url.pathname!=='/api/desktop/schedule/operations') return Response.json({error:'No other writes are enabled.'},{status:403});
    const body=JSON.parse(String(init.body));
    writes.push(body);
    if(result==='held') await new Promise<void>(resolve=>{releaseVerification=resolve;window.dispatchEvent(new Event('fixture-write'));});
    const status=result==='held'?'verified':result;
    if(status==='verified') {
      if(body.action==='cancel') cancellations.add(body.recordId);
      else if(body.action==='move') assignments.set(body.recordId,body.values.truck);
    }
    window.dispatchEvent(new Event('fixture-write'));
    return Response.json({receipt:{requestId:body.requestId,status,message:`Synthetic move result: ${status}.`}});
  }
  if(url.pathname==='/api/desktop/schedule/operations' && writes.length){
    const body=writes.at(-1)!;
    assignments.set(body.recordId,body.values.truck);
    return Response.json({receipt:{requestId:url.searchParams.get('requestId'),status:'verified',message:'Synthetic saved result verified.'}});
  }
  if(url.pathname==='/api/desktop/schedule')return Response.json({date,observedAt:'2026-09-07T21:00:00Z',sourceRequest:{state:'ready',message:''},appointments:appointments(date),truckLoads:new URLSearchParams(location.search).has('loads')?[{truck:'Truck 1',label:'Full truck',note:'Synthetic load'},{truck:'Truck 3',label:'Full + 1/6',note:'Synthetic load'}]:undefined,fleet:{isToday:progressEnabled || scenario==='on-site' || longDetails && date==='2026-09-07',lastUpdatedAt:null,trucks:progressEnabled?[{truck:'Truck 9',latitude:30.45,longitude:-91.18,lastGpsUpdate:progressGps(),speed:progressStage.startsWith('parked')?0:25,ignition:progressStage.startsWith('parked')?'OFF':'ON',freshnessLabel:'Recent GPS',operationalStatus:'Available',driver:'Example driver',navigator:'',serviceStatus:'Available'}]:scenario==='on-site'?[{truck:'Truck 8',latitude:30.45,longitude:-91.18,lastGpsUpdate:new Date(Date.now()-300_000).toISOString(),freshnessLabel:'GPS Stale',operationalStatus:'GPS Stale',ignition:'OFF',driver:'Example Driver',navigator:'Example Navigator',serviceStatus:'Unavailable'}]:[]}});
  if(url.pathname==='/api/desktop/schedule/routes' && scenario==='route-stack') {
    const jobs=appointments(date);
    const legs=[0,1].map(i=>({truck:'Truck 9',fromAppointmentId:jobs[i].recordId,toAppointmentId:jobs[i+1].recordId,fromJk:jobs[i].jkNumber,toJk:jobs[i+1].jkNumber,fromEndMinutes:jobs[i].appointmentEndMinutes,toStartMinutes:jobs[i+1].appointmentStartMinutes,gapMinutes:i===0?60:-60,travelMinutes:i===0?31:29,miles:i===0?16.2:20.8,status:'available'}));
    return Response.json({date,calculatedAt:null,legs,closest:[],appointmentId:null,truckProgress:progressEnabled?[{truck:'Truck 9',appointmentId:jobs[1].recordId,appointmentVersion:jobs[1].version,status:progressStage==='onsite'?'on_site':progressStage==='stale'?'stale_gps':'available',minutes:progressStage==='approaching'?12:5,miles:4,gpsAt:progressGps(),calculatedAt:new Date().toISOString(),arrivalAt:new Date(Date.now()+(progressStage==='approaching'?12:5)*60000).toISOString()}]:[]});
  }
  if(url.pathname==='/api/desktop/schedule/routes' && routeMode==='failed') return Response.json({error:'Synthetic unavailable routing'},{status:503});
  if(url.pathname==='/api/desktop/schedule/routes')return Response.json({date,calculatedAt:null,legs:[],closest:scenario==='on-site'?[{truck:'Truck 9',status:'available',minutes:62,miles:48.4,gpsUpdatedAt:null}]:longDetails?Array.from({length:8},(_,index)=>({truck:`Truck ${index+1}`,status:routeMode==='stale'?'stale_gps':'available',minutes:10+index,miles:5+index,gpsUpdatedAt:null})):[],appointmentId:longDetails || scenario==='on-site'?url.searchParams.get('appointment'):null});
  return Response.json({error:'No operational sources are enabled in this fixture.'},{status:503});
};
function Fixture(){
  const [day,setDay]=useState<'today'|'tomorrow'>('tomorrow');
  const [,setVersion]=useState(0);
  useEffect(()=>{const update=()=>setVersion(value=>value+1);window.addEventListener('fixture-write',update);return()=>window.removeEventListener('fixture-write',update);},[]);
  return <main className="ops-live" style={{padding:12}}><h1 style={{fontSize:16}}>Dispatch check · synthetic {scenario} day · synthetic GPS only</h1><p id="fixture-writes" role="status">Writes: {writes.length}{writes.length?` · ${writes.at(-1)!.date} · ${writes.at(-1)!.recordId} → ${writes.at(-1)!.values.truck || 'Unassigned'}`:''}</p>{releaseVerification && <button onClick={()=>{releaseVerification?.();releaseVerification=undefined;}}>Release Verified Receipt</button>}<>{progressEnabled && <><button onClick={()=>{progressStage='closer';}}>Move truck closer</button><button onClick={()=>{progressStage='onsite';}}>Truck arrives</button><button onClick={()=>{progressStage='stale';}}>GPS stops reporting</button><button onClick={()=>{progressStage='parked';}}>Truck parked 30 minutes</button><button onClick={()=>{progressStage='parked-overdue';}}>Parked report overdue</button></>}</><div className="workspace"><div className="workspace-heading schedule-workspace-heading"><div><span className="eyebrow">Synthetic preview</span><h1>Schedule</h1></div><div className="schedule-heading-actions"><div className="schedule-view-switcher workspace-tabs" role="group" aria-label="Schedule views"><button className="active">Board</button><button>Calendar</button><button>Follow-Up</button><button>History</button></div></div></div></div><LiveSchedule baseDate="2026-09-07" day={day} onDayChange={setDay} report={()=>{}}/></main>;
}
const root=createRoot(document.getElementById('root')!);
root.render(<Fixture/>);
import.meta.hot?.dispose(()=>root.unmount());
