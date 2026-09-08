import React from 'react';
import {createRoot} from 'react-dom/client';
import AppointmentCreation from '../appointment-creation';
import type {ScheduleAppointment} from '../lib/schedule-contract';
import '../app/globals.css';
import '../live-schedule.css';
import '../live-responsive.css';
import '../workspace-density.css';
const date=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Chicago'}).format(new Date());
const job={recordId:date+':appointment:123',appointmentId:'123',jkNumber:'JK1000123',customerName:'Synthetic Customer',phone:'5045550100',address:'100 Example Road New Orleans LA 70119',appointmentTime:'9:00–10:00 AM',truck:'Truck 8',territory:'Jefferson Parish',appointmentType:'Estimate',status:'Confirmed',appointmentUrl:'https://junkware.junk-king.com/appointment.aspx?id=123'} as ScheduleAppointment;
window.fetch=async(url,options)=>{
 if(String(url).endsWith('/check'))return new URLSearchParams(location.search).has('fail')?Response.json({error:'Duplicate check unavailable. No appointment was created.'},{status:503}):Response.json({check:{fingerprint:'a'.repeat(64),observedAt:new Date().toISOString(),matches:new URLSearchParams(location.search).has('clear')?[]:[job]}});
 const body=JSON.parse(options?.body as string);document.querySelector('#submission')!.textContent=JSON.stringify(body.duplicateReview);
 return Response.json({error:'Appointments changed. Review again.'},{status:409});
};
createRoot(document.getElementById('root')!).render(<><AppointmentCreation date={date} appointments={[job]} close={()=>{}} saved={()=>{}} onBusyChange={()=>{}}/><output id="submission"/></>);
