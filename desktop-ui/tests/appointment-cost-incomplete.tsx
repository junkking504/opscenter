import React from 'react';
import {createRoot} from 'react-dom/client';
import {AppointmentRegisterRow} from '../appointment-register-row';
import AppointmentCost from '../appointment-cost';
import {calculateAppointmentCost,defaultCostInputs,type AppointmentCostSummary} from '../../lib/appointment-cost-model';
import type {ScheduleAppointment} from '../lib/schedule-contract';
import '../app/globals.css';
import '../live-responsive.css';
import '../workspace-density.css';
import '../live-schedule.css';
const travel={miles:40,minutes:60,inbound:'HQ',outbound:'HQ',note:'Synthetic road allocation',approximate:false};
const inputs={...defaultCostInputs,onsiteMinutes:60,disposal:30,extraCosts:15,revenueFeePercent:20};
const noFuel={...calculateAppointmentCost(inputs,travel,null,40),attendanceAssumptions:['Provisional overhead: $109 per appointment; original inclusions unverified.'],breakEvenAssumptions:['Provisional overhead: $109 per appointment; original inclusions unverified.']};
const complete=calculateAppointmentCost(inputs,travel,4,40);
const gap=calculateAppointmentCost({...inputs,onsiteMinutes:null,disposal:null},{...travel,miles:null,minutes:null},null,null);
const base={recordId:'synthetic',jkNumber:'SYNTHETIC',appointmentId:'synthetic',appointmentTime:'10:00 AM–11:00 AM',customerName:'Fictional Customer',phone:'',address:'100 Example Street',territory:'New Orleans',appointmentType:'Job',status:'Confirmed',truck:'Truck 3',driver:'',navigator:'',junkItems:['Furniture'],appointmentNotes:[],closeout:null,location:{latitude:30,longitude:-90}} as ScheduleAppointment;
globalThis.fetch=async input=>{
 if(!String(input).startsWith('/api/desktop/schedule/cost'))throw new Error('Unexpected synthetic request');
 return Response.json({record:{version:0,inputs,actor:null,savedAt:null},travel,fuel:{price:{price:4,at:'2026-01-01T12:00:00Z',amount:80,gallons:20,truck:'Truck 3',trackingNumber:'synthetic',source:'Synthetic WEX',sourceUrl:'https://outlook.office365.com/owa/?synthetic'},importedAt:'2026-01-01T12:00:00Z'},priceIsRecent:false,sourceCrewHourly:40,crewCount:2,crewRateDates:['2026-10-24'],observedAt:null});
};
const scenarios:{id:string;job?:Partial<ScheduleAppointment>;summary:AppointmentCostSummary|null;loading?:boolean;error?:boolean}[]=[
 {id:'unquoted',summary:noFuel},
 {id:'quoted',job:{closeout:{total:400,tip:0,balance:0,payments:[]}},summary:noFuel},
 {id:'paid',job:{status:'Completed',closeout:{total:400,tip:0,balance:0,payments:[{method:'Cash',detail:'',amount:400}]}},summary:noFuel},
 {id:'unassigned',job:{truck:'Virtual Truck'},summary:noFuel},
 {id:'route-missing',job:{location:null},summary:gap},
 {id:'disposal-only',job:{closeout:{total:400,tip:0,balance:0,payments:[]}},summary:calculateAppointmentCost({...inputs,disposal:null},travel,4,40)},
 {id:'complete',summary:complete},
 {id:'failed',summary:{attendance:null,breakEven:null,breakEvenBeforeDisposal:null,missing:['Cost sources unavailable']}},
 {id:'refreshing',summary:noFuel,loading:true},
 {id:'refresh-error',summary:noFuel,error:true},
 {id:'loading',summary:null,loading:true},
 {id:'canceled',job:{status:'Canceled'},summary:noFuel},
];
function App(){const [opened,setOpened]=React.useState('');return <main className="ops-live live-schedule" style={{padding:16}}><h1>Synthetic cost acceptance</h1><section className="appointment-register">{scenarios.map(row=><div key={row.id} data-testid={row.id}><AppointmentRegisterRow job={{...base,...row.job,jkNumber:row.id}} area="New Orleans" selected={false} select={()=>{}} open={()=>setOpened(row.id)} attendance={{summary:row.summary,loading:row.loading??false,error:row.error}}/></div>)}</section><output>{opened?`Opened ${opened}`:''}</output><AppointmentCost date="2026-10-24" id="synthetic"/></main>;}
createRoot(document.getElementById('root')!).render(<App/>);
