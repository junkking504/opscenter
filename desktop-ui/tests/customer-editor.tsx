import {createRoot} from 'react-dom/client';
import {useState} from 'react';
import CustomerEditor from '../customer-editor';
import type {ScheduleAppointment} from '../lib/schedule-contract';
const state=window as unknown as {writes:number;saved:boolean};state.writes=0;state.saved=false;
const customer={firstName:'Test',lastName:'Customer',phone:'5045550100',secondaryPhone:'',email:'test@example.com',address:'100 Example St',zip:'70112'};
const parameters=new URLSearchParams(location.search),actorKey=parameters.get('actor') || 'manager-one';
const realFetch=window.fetch.bind(window);
window.fetch=async(input,init)=>{
 const url=String(input);
 if(url.includes('/schedule/customer')){
  if(parameters.get('role')==='operator')return Response.json({error:'Not permitted'},{status:403});
  return Response.json({actorKey,pendingReceipt:null,blockedByOtherActor:false,...(!url.includes('statusOnly')?{customer,sourceVersion:'a'.repeat(64),protectedVersion:'b'.repeat(64)}:{})});
 }
 if(url.includes('/schedule/operations')){
  const data=init?.body ? JSON.parse(String(init.body)) : {};
  if(data.resolveCustomerRequest)return Response.json({receipt:{requestId:data.requestId,status:'reconciled',message:'Manager reviewed source. No source save.'}});
  if(init?.method==='POST'){state.writes++;return Response.json({receipt:{requestId:data.requestId,status:parameters.get('result') || 'verified',message:'Fixture result'}});}
  return Response.json({error:'No receipt found'},{status:404});
 }
 return realFetch(input,init);
};
function App(){const [busy,setBusy]=useState(false);return <div style={{maxWidth:550,padding:12}}><CustomerEditor job={{appointmentId:'123',recordId:'2026-10-21:appointment:123',version:'c'.repeat(64)} as ScheduleAppointment} date="2026-10-21" saved={()=>{state.saved=true;}} onBusyChange={setBusy} disabled={busy}/></div>;}
createRoot(document.getElementById('root')!).render(<App/>);
