import React from 'react';
import { createRoot } from 'react-dom/client';
import { AppointmentRegisterRow } from '../appointment-register-row';
import type { ScheduleAppointment } from '../lib/schedule-contract';
import '../app/globals.css';
import '../live-responsive.css';
import '../workspace-density.css';
import '../live-schedule.css';
const base = { recordId:'synthetic',jkNumber:'JK10001',appointmentTime:'10:00 AM–11:00 AM',customerName:'Synthetic Customer',phone:'5045550100',address:'100 Example Street New Orleans LA 70119',appointmentType:'Job',status:'Completed',truck:'Truck 3',driver:'Example Driver',navigator:'Example Navigator',junkItems:['Furniture','Construction debris'],appointmentNotes:['Full note available in details'],paymentAmount:100,tipAmount:20,closeout:{total:100,tip:20,balance:0,payments:[{method:'Credit Card',detail:'',amount:120}]}} as ScheduleAppointment;
const jobs = [base,{...base,jkNumber:'JK10002',closeout:{...base.closeout!,balance:50,payments:[{method:'Cash',detail:'',amount:70}]}},{...base,jkNumber:'JK10003',appointmentType:'Estimate'},{...base,jkNumber:'JK10004',closeout:null},{...base,jkNumber:'JK10005',closeout:{...base.closeout!,payments:[{method:'Billed',detail:'',amount:100}]}},{...base,jkNumber:'JK10006',status:'Canceled',cancellationReason:'Customer requested cancellation',closeout:null}];
function App() { const [opened,setOpened]=React.useState(''); const [selected,setSelected]=React.useState(''); return <main className="ops-live live-schedule" style={{padding:16}}><section className="appointment-register"><div className="section-title"><h2>All Appointments · synthetic QA</h2></div><div className="appointment-register-head"><span>Appointment</span><span>Customer & work</span><span>Assignment</span><span>Payment · JunkWare recorded</span><span>Status & details</span></div>{jobs.map(job=><AppointmentRegisterRow key={job.jkNumber} job={job} area="New Orleans" selected={selected===job.jkNumber} select={()=>setSelected(job.jkNumber)} open={()=>setOpened(job.jkNumber)}/>)}</section><output>{opened ? `Opened ${opened}` : ''}</output></main>; }
createRoot(document.getElementById('root')!).render(<App/>);
