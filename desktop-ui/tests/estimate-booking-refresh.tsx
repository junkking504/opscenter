import React from 'react';
import {createRoot} from 'react-dom/client';
import EstimateBooking from '../estimate-booking';
import '../app/globals.css';
import '../live-schedule.css';
import '../live-responsive.css';
import '../workspace-density.css';
let calls=0;
const params=new URLSearchParams(location.search);
window.fetch=async(url,options)=>{
 if(String(url)!=='/api/desktop/schedule/creation/check')throw new Error('Only synthetic review requests allowed');
 const input=JSON.parse(String(options?.body));calls++;document.querySelector('#requests')!.textContent=String(calls);
 if(calls<3)return Response.json({pending:true},{status:202});
 if(params.has('fail'))return Response.json({error:'JunkWare could not check this date. Your booking details are saved. Try Review Booking again shortly.'},{status:503});
 return Response.json({check:{fingerprint:'a'.repeat(64),observedAt:new Date().toISOString(),matches:params.has('duplicate')?[{jkNumber:'SYNTHETIC-OTHER',appointmentTime:'9:00 AM–10:00 AM'}]:[],date:input.date}});
};
createRoot(document.getElementById('root')!).render(<main style={{padding:16,maxWidth:560,margin:'auto'}}><h2>Synthetic appointment</h2><p>Estimate quoted · $198.00</p><p>Quote only · not a payment</p><EstimateBooking estimate={{id:'900001',jk:'SYNTHETIC',customer:'Synthetic Customer',phone:'5045550100',address:'100 Example Road New Orleans LA 70119',territory:'New Orleans'}} saved={()=>{}}/><output id="requests"/></main>);
