import React,{useEffect,useState} from 'react';
import {createRoot} from 'react-dom/client';
import {ScheduleCrewRoster} from '../schedule-crew-roster';
import type {DayRoster,RosterEntry} from '../../lib/schedule-crew-roster';
import '../app/globals.css';
import '../live-responsive.css';
import '../workspace-density.css';
import '../css-phase-two.css';
import '../desktop-presentation.css';
import '../workspace-consistency.css';
import '../command-mobile.css';
import '../live-schedule-styles';
import '../opscenter-brand.css';
import '../approved-workbench.css';
import '../theme.css';

type RequestBody={date:string;expectedVersion:number;entries:RosterEntry[]};
const names=Array.from({length:14},(_,index)=>`Synthetic Crew ${String.fromCharCode(65+index)}`);
const initial=(date:string):DayRoster=>({date,version:3,savedAt:'2026-10-25T18:15:00Z',actor:'fixture',entries:names.map((name,index)=>({name,status:index<5?'scheduled':index<9?'pending':'off',truck:index<3?'Truck 1':'',startTime:index<5?'07:00':''}))});
const qa={reads:[] as string[],writes:[] as RequestBody[],readOnly:false,failNextSave:false,failNextLoad:false,delay:0,changeDate:(_date:string)=>{},setBusy:(_busy:boolean)=>{}};
Object.assign(window,{rosterQa:qa});
const saved=new Map<string,DayRoster>();
window.fetch=async(input,init)=>{
 const url=new URL(typeof input==='string'?input:input instanceof URL?input.href:input.url,window.location.href);
 if(url.pathname!=='/api/desktop/schedule/roster')return new Response('Unexpected fixture request',{status:404});
 const reply=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{'content-type':'application/json'}});
 if(init?.method==='POST'){
  const request=JSON.parse(String(init.body)) as RequestBody;
  qa.writes.push(request);
  if(qa.delay)await new Promise(resolve=>setTimeout(resolve,qa.delay));
  if(qa.failNextSave){qa.failNextSave=false;return reply({error:'Roster changed. Close and reopen it before saving.'},409);}
  const roster={date:request.date,version:request.expectedVersion+1,entries:request.entries,savedAt:'2026-10-25T19:15:00Z',actor:'fixture'};
  saved.set(request.date,roster);
  return reply({roster});
 }
 const date=url.searchParams.get('date')||'2026-10-26';
 qa.reads.push(date);
 if(qa.delay)await new Promise(resolve=>setTimeout(resolve,qa.delay));
 if(qa.failNextLoad){qa.failNextLoad=false;return reply({error:'Synthetic roster unavailable.'},503);}
 return reply({roster:saved.get(date)||initial(date),names,trucks:['Truck 1','Truck 2'],canWrite:!qa.readOnly});
};
function Fixture(){
 const [date,setDate]=useState('2026-10-26'),[busy,setBusy]=useState(false);
 useEffect(()=>{qa.changeDate=setDate;qa.setBusy=setBusy;},[]);
 return <div className="ops-app ops-live" data-css-phase-two="Schedule"><main className="ops-content"><section className="live-schedule schedule-dispatch"><h1>Synthetic Command</h1><div className="schedule-control-actions"><ScheduleCrewRoster date={date} busy={busy}/></div><p>No operational data or provider calls.</p></section></main></div>;
}
createRoot(document.getElementById('root')!).render(<Fixture/>);
