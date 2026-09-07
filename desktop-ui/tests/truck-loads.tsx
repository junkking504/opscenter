import {useState} from 'react';
import {createRoot} from 'react-dom/client';
import LiveSchedule from '../live-schedule';
import LiveFleet from '../live-fleet';
import '../app/globals.css';
import '../live-responsive.css';
import '../workspace-density.css';

const date='2026-09-06';
const loads=[{truck:'Truck 2',label:'1/4 full',percent:25,needsVerification:false,note:''},{truck:'Truck 4',label:'1/2 full',percent:50,needsVerification:false,note:''},{truck:'Truck 6',label:'Verify load',percent:null,needsVerification:true,note:'Confirm the pickup order around the unload.'}];
loads.push(...[1,8,9,10].map(number=>({truck:`Truck ${number}`,label:'Empty',percent:0,needsVerification:false,note:''})));
// Read-only display fixture. No source writes, customer records, or external API calls.
window.fetch=async(input,init)=>{
  const url=new URL(String(input),location.origin);
  if(init?.method && init.method!=='GET') throw new Error('This fixture cannot write.');
  const fleet={isToday:false,lastUpdatedAt:null,trucks:loads.map(load=>({truck:load.truck,latitude:null,longitude:null,lastGpsUpdate:null,freshnessLabel:'Unavailable',driver:'Example driver',navigator:'',operationalStatus:'Parked',serviceStatus:'Available'}))};
  const appointments=loads.map((load,index)=>({recordId:`${date}:appointment:${1001+index}`,appointmentId:String(1001+index),version:'a'.repeat(64),callAhead:'not_called',jkNumber:`JK100000${index}`,appointmentUrl:'',appointmentTime:'9:00 AM–10:00 AM',appointmentStartMinutes:540,appointmentEndMinutes:600,hasScheduledTime:true,customerName:'Example customer',customerEmail:'',phone:'',address:'',territory:'Baton Rouge',appointmentType:'Job',status:'Completed',truck:load.truck,driver:'Example driver',navigator:'',paymentType:'Cash',paymentAmount:100,tipAmount:0,junkItems:['Furniture'],appointmentNotes:[],cancellationReason:'',location:null}));
  const body=url.pathname.endsWith('/routes')?{date,calculatedAt:null,legs:[],closest:[],appointmentId:null}:url.pathname==='/api/desktop/schedule'?{date:url.searchParams.get('date'),observedAt:'2026-09-06T23:00:00Z',appointments,truckLoads:loads,fleet}:url.pathname==='/api/desktop/fleet'?{date,report:'overview',sourceAvailable:true,canWrite:false,sourceUpdatedAt:null,issues:[],maintenance:[],reportRows:[],reportCoverageDays:0,warnings:[],trucks:loads.map(load=>({id:load.truck,label:load.truck,vehicle:'Example truck',readiness:'Ready',operatingStatus:'Parked',driver:'Example driver',navigator:'',assignment:'',location:'Unavailable',gpsAt:null,gpsFreshness:'Unavailable',odometer:'',serviceStatus:'Available',nextService:'',checklist:'Complete',loadPercent:load.percent,loadLabel:load.label,loadNote:load.note,loadVersion:'a'.repeat(64),checklistVersion:'a'.repeat(64),checklists:Object.fromEntries(['daily','weekly','monthly'].map(key=>[key,{version:'a'.repeat(64),inspector:'Example',definitions:[],answers:[]}])),checklistDefinitions:[],answers:[],jobs:1,revenue:100,miles:null,idleMinutes:null,driverScore:null}))}:{};
  return Response.json(body);
};
function Fixture(){const[view,setView]=useState('schedule');return <main className="ops-live" style={{padding:16}}><h1>Truck load display · synthetic preview</h1><nav><button onClick={()=>setView('schedule')}>Schedule preview</button><button onClick={()=>setView('fleet')}>Fleet preview</button></nav>{view==='schedule'?<LiveSchedule baseDate={date} day="today" onDayChange={()=>{}} report={()=>{}}/>:<LiveFleet date={date} view="overview" report="overview"/>}</main>;}
createRoot(document.getElementById('root')!).render(<Fixture/>);
