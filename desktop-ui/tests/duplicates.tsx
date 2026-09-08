import React from 'react';
import {createRoot} from 'react-dom/client';
import {useState} from 'react';
import ScheduleDuplicates from '../schedule-duplicates';
import type {ScheduleSnapshot,ScheduleAppointment} from '../lib/schedule-contract';
import {duplicateBookings,type DuplicateReview} from '../lib/duplicate-bookings';
import '../app/globals.css';
import '../live-schedule.css';
import '../live-responsive.css';
import '../workspace-density.css';
const make=(id:string)=>({recordId:'2026-09-08:appointment:'+id,appointmentId:id,jkNumber:'JK10000'+id,customerName:'Sample Customer',phone:'225-555-0100',address:'100 Example Road, Greenwell Springs, LA 70739',territory:id==='1'?'New Orleans':'Baton Rouge',truck:'Truck '+id,appointmentType:id==='1'?'Job':'Estimate',status:'Confirmed',hasScheduledTime:true,appointmentStartMinutes:720,appointmentEndMinutes:780,appointmentTime:'12:00–1:00 PM',appointmentUrl:'https://junkware.junk-king.com/franchise/appointment.aspx?id='+id} as ScheduleAppointment);
const jobs=[make('1'),make('2')];const pair=duplicateBookings(jobs)[0];
let review:DuplicateReview={key:pair.key,signature:pair.signature,fingerprint:'a'.repeat(64),decision:null};
window.fetch=async(_url,options)=>{
  if(new URLSearchParams(location.search).has('fail'))return Response.json({error:'Saved reviews unavailable.'},{status:503});
  if(options?.method==='POST') {const body=JSON.parse(options.body as string);review={...review,decision:{state:body.state,actor:'Synthetic Operator',at:'2026-09-08T12:00:00Z',revision:String(Date.now())}};return Response.json({review});}
  return Response.json({reviews:[review]});
};
function App(){const[opened,setOpened]=useState('');return <main style={{fontFamily:'Arial, sans-serif',maxWidth:1150,margin:'24px auto'}}><h1>Synthetic Duplicate Review</h1><ScheduleDuplicates snapshot={{date:'2026-09-08',appointments:jobs} as ScheduleSnapshot} busy={false} open={setOpened}/><p role="status">{opened?'Opened '+opened:''}</p></main>;}
createRoot(document.getElementById('root')!).render(<App/>);
