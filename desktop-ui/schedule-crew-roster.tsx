import {useEffect,useId,useRef,useState} from 'react';
import type {DayRoster,RosterEntry} from '../lib/schedule-crew-roster';
import {truckDisplayLabel} from '../lib/junkware-trucks';
import './schedule-crew-roster.css';

const quickTimes=[['07:00','7:00'],['07:15','7:15'],['07:30','7:30']] as const;
function timeLabel(value:string){
 const match=/^([01]\d|2[0-3]):([0-5]\d)$/.exec(value);
 if(!match)return 'Set time';
 const hour=Number(match[1]);
 return `${hour%12||12}:${match[2]} ${hour<12?'AM':'PM'}`;
}

/** Planned attendance only. All edits remain local until Save roster. */
export function ScheduleCrewRoster({date,busy}:{date:string;busy:boolean}){
 const dialog=useRef<HTMLDialogElement>(null);
 const trigger=useRef<HTMLButtonElement>(null);
 const keepEditing=useRef<HTMLButtonElement>(null);
 const closeOrigin=useRef<HTMLElement|null>(null);
 const workingRef=useRef(false);
 const id=useId();
 const [roster,setRoster]=useState<DayRoster|null>(null);
 const [rows,setRows]=useState<RosterEntry[]>([]);
 const [savedRows,setSavedRows]=useState('[]');
 const [trucks,setTrucks]=useState<string[]>([]);
 const [working,setWorking]=useState(false);
 const [message,setMessage]=useState('');
 const [canWrite,setCanWrite]=useState(false);
 const [openedDate,setOpenedDate]=useState(date);
 const [isOpen,setIsOpen]=useState(false);
 const [timeEditor,setTimeEditor]=useState<string|null>(null);
 const [confirmClose,setConfirmClose]=useState(false);
 const dirty=JSON.stringify(rows)!==savedRows;
 const disabled=working||busy||!canWrite||confirmClose;
 const scheduled=rows.filter(row=>row.status==='scheduled');

 useEffect(()=>{
  if(!isOpen||!dirty)return;
  const warn=(event:BeforeUnloadEvent)=>{event.preventDefault();event.returnValue='';};
  window.addEventListener('beforeunload',warn);
  return ()=>window.removeEventListener('beforeunload',warn);
 },[isOpen,dirty]);
 useEffect(()=>{
  if(confirmClose)keepEditing.current?.focus();
  else if(closeOrigin.current){closeOrigin.current.focus({preventScroll:true});closeOrigin.current=null;}
 },[confirmClose]);

 const close=()=>{setConfirmClose(false);setTimeEditor(null);dialog.current?.close();};
 const requestClose=(origin?:HTMLElement)=>{
  if(workingRef.current||busy)return;
  if(dirty){closeOrigin.current=origin||(document.activeElement instanceof HTMLElement?document.activeElement:null);setConfirmClose(true);}
  else close();
 };
 const cancelClose=()=>setConfirmClose(false);
 const open=async()=>{
  if(workingRef.current||busy||dialog.current?.open)return;
  workingRef.current=true;setWorking(true);setOpenedDate(date);setIsOpen(true);
  setRoster(null);setRows([]);setSavedRows('[]');setTrucks([]);setCanWrite(false);setMessage('');setTimeEditor(null);setConfirmClose(false);
  dialog.current?.showModal();
  try{
   const response=await fetch(`/api/desktop/schedule/roster?date=${date}`,{cache:'no-store'});
   const body=await response.json();
   if(!response.ok)throw new Error(body.error||'Roster could not load.');
   const names=[...new Set<string>([...body.names,...body.roster.entries.map((row:RosterEntry)=>row.name)])];
   const loaded=names.map(name=>body.roster.entries.find((row:RosterEntry)=>row.name===name)||{name,status:'pending',truck:'',startTime:''});
   setRoster(body.roster);setTrucks(body.trucks);setCanWrite(body.canWrite);setRows(loaded);setSavedRows(JSON.stringify(loaded));
  }catch(error){setMessage(error instanceof Error?error.message:'Roster could not load.');}
  finally{workingRef.current=false;setWorking(false);}
 };
 const update=(index:number,patch:Partial<RosterEntry>)=>{
  if(workingRef.current||busy||!canWrite||confirmClose)return;
  setRows(prior=>prior.map((row,i)=>i===index?{...row,...patch}:row));setMessage('');
 };
 const closeTimeEditor=(index:number)=>{
  setTimeEditor(null);
  dialog.current?.querySelector<HTMLButtonElement>(`#${CSS.escape(`${id}-time-${index}`)}`)?.focus({preventScroll:true});
 };
 const save=async()=>{
  if(!roster||workingRef.current||busy||!canWrite||confirmClose)return;
  const missing=rows.findIndex(row=>row.status==='scheduled'&&!row.startTime);
  if(missing!==-1){
   setTimeEditor(rows[missing].name);setMessage(`Choose a start time for ${rows[missing].name}.`);
   dialog.current?.querySelector<HTMLButtonElement>(`#${CSS.escape(`${id}-time-${missing}`)}`)?.focus();
   return;
  }
  workingRef.current=true;setWorking(true);setMessage('');
  try{
   const response=await fetch('/api/desktop/schedule/roster',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({date:openedDate,expectedVersion:roster.version,entries:rows})});
   const body=await response.json();
   if(!response.ok)throw new Error(body.error||'Save could not be verified. Close and reopen the roster to check.');
   setRoster(body.roster);setRows(body.roster.entries);setSavedRows(JSON.stringify(body.roster.entries));setTimeEditor(null);setMessage('Roster saved.');
  }catch(error){setMessage(error instanceof Error?error.message:'Save could not be verified. Close and reopen the roster to check.');}
  finally{workingRef.current=false;setWorking(false);}
 };

 return <>
  <button ref={trigger} type="button" disabled={busy||working} onClick={()=>void open()}>Krewe roster</button>
  <dialog ref={dialog} className="schedule-crew-roster" aria-labelledby={`${id}-title`} aria-describedby={`${id}-date`} data-gesture-ignore
   onCancel={event=>{event.preventDefault();if(confirmClose)cancelClose();else requestClose();}}
   onClose={()=>{setIsOpen(false);setConfirmClose(false);setTimeEditor(null);trigger.current?.focus({preventScroll:true});}}>
   <header className="crew-roster-heading">
    <div><h2 id={`${id}-title`}>Krewe roster</h2><p id={`${id}-date`}>{openedDate} · Central time</p></div>
    <button type="button" disabled={working||busy} onClick={event=>requestClose(event.currentTarget)} aria-label="Close krewe roster">Close</button>
   </header>
   {roster&&<div className="crew-roster-summary"><strong>{scheduled.length} coming in</strong><span>{scheduled.filter(row=>!row.truck).length} unassigned</span><span>{rows.filter(row=>row.status==='off').length} off</span></div>}
   <div className="crew-roster-body" aria-busy={working}>
    {working&&!roster?<p role="status">Loading roster…</p>:roster&&<>
     {!canWrite&&<p className="crew-roster-readonly">View only. Your account cannot edit this roster.</p>}
     <div className="crew-roster-rows">{rows.map((row,index)=>{
      const editing=timeEditor===row.name;
      const timeId=`${id}-time-${index}`;
      return <section key={row.name} className="crew-roster-row" aria-labelledby={`${id}-name-${index}`} data-status={row.status}>
       <div className="crew-roster-person"><strong id={`${id}-name-${index}`}>{row.name}</strong>
        <label className="crew-roster-status"><span className="sr-only">Status</span><select aria-label={`${row.name} status`} disabled={disabled} value={row.status} onChange={event=>{
         update(index,{status:event.target.value as RosterEntry['status'],...(event.target.value!=='scheduled'?{truck:'',startTime:''}:{})});
         if(event.target.value!=='scheduled'&&editing)setTimeEditor(null);
        }}><option value="pending">Pending</option><option value="scheduled">Scheduled</option><option value="off">Off</option></select></label>
       </div>
       {row.status==='scheduled'&&<div className="crew-roster-assignment">
        <label className="crew-roster-truck"><span>Truck</span><select aria-label={`${row.name} truck`} disabled={disabled} value={row.truck} onChange={event=>update(index,{truck:event.target.value})}><option value="">Unassigned</option>{trucks.map(truck=><option key={truck} value={truck}>{truckDisplayLabel(truck)}</option>)}</select></label>
        <div className="crew-roster-start"><span id={`${timeId}-label`}>Start time</span><button id={timeId} className="crew-roster-time-trigger" type="button" disabled={disabled} aria-label={`${row.name} start time: ${row.startTime?timeLabel(row.startTime):'not set'}`} aria-expanded={editing} aria-controls={`${timeId}-editor`} onClick={()=>setTimeEditor(editing?null:row.name)}><svg aria-hidden="true" viewBox="0 0 24 24" width="16" height="16"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg><span>{timeLabel(row.startTime)}</span><span aria-hidden="true">⌄</span></button></div>
        {editing&&<div id={`${timeId}-editor`} className="crew-roster-time-editor" role="group" aria-label={`${row.name} start time choices`}>
         <div className="crew-roster-time-presets"><span>Quick start · AM</span><div>{quickTimes.map(([value,label])=><button key={value} type="button" disabled={disabled} aria-label={`${row.name} start at ${label} AM`} aria-pressed={row.startTime===value} onClick={()=>{update(index,{startTime:value});closeTimeEditor(index);}}>{label}</button>)}</div></div>
         <div className="crew-roster-custom-time"><label htmlFor={`${timeId}-custom`}>Custom time<input id={`${timeId}-custom`} aria-label={`${row.name} custom start time`} type="time" step="60" disabled={disabled} value={row.startTime} onChange={event=>update(index,{startTime:event.target.value})}/></label><button type="button" disabled={disabled} onClick={()=>closeTimeEditor(index)}>Done</button></div>
        </div>}
       </div>}
      </section>;
     })}</div>
     {!rows.length&&<p>No crew members are configured.</p>}
    </>}
   </div>
   <footer className="crew-roster-footer">
    {message&&<p role="status" className="crew-roster-message">{message}</p>}
    {confirmClose?<div className="crew-roster-discard" role="group" aria-labelledby={`${id}-discard`}><p id={`${id}-discard`}>Discard unsaved roster changes?</p><div><button ref={keepEditing} type="button" onClick={cancelClose}>Keep editing</button><button type="button" onClick={close}>Discard changes</button></div></div>:roster&&<div className="crew-roster-save"><div><strong>{dirty?'Unsaved changes':roster.savedAt?'Roster saved':'Not saved yet'}</strong>{roster.savedAt&&<small>Saved {new Date(roster.savedAt).toLocaleString('en-US',{timeZone:'America/Chicago'})}</small>}</div><button className="crew-roster-save-button" data-variant="brand" type="button" disabled={disabled||!rows.length} onClick={()=>void save()}>{working?'Saving…':'Save roster'}</button></div>}
   </footer>
  </dialog>
 </>;
}
