'use client';
import {useCallback,useEffect,useRef,useState} from 'react';
import type {DesktopAppointment} from '@/lib/desktop-schedule';
import type {CrewPhone,CrewPhoneDay} from '@/lib/crew-phone';
import {sameTruck,truckDisplayText} from '@/lib/junkware-trucks';
import {orderGroups,orderGroupKey,orderSourceKey} from '@/lib/schedule-stop-order';
import styles from './phone-access.module.css';
import ManagerBooking from './manager-booking';
import ManagerEdit from './manager-edit';

type Snapshot={date:string;observedAt:string|null;appointments:DesktopAppointment[];phone:CrewPhone;day:CrewPhoneDay|null;roster:string[];trucks:string[]};
type ManagedPhone=CrewPhone & {state:string;access:string};
import {managerRequest} from './manager-api';
export default function ManagerApp({onCrew}:{onCrew:()=>void}){
 const today=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Chicago'}).format(new Date());
 const [date,setDate]=useState(today),[data,setData]=useState<Snapshot|null>(null),[selected,setSelected]=useState('');
 const [busy,setBusy]=useState(false),[error,setError]=useState(''),[message,setMessage]=useState('');
 const [phones,setPhones]=useState<ManagedPhone[]|null>(null),[booking,setBooking]=useState(false),[editing,setEditing]=useState(false);
 const [action,setAction]=useState('note'),[text,setText]=useState(''),[truck,setTruck]=useState('Truck 1'),[destination,setDestination]=useState(today),[hour,setHour]=useState('09:00');
 const [driver,setDriver]=useState(''),[navigator,setNavigator]=useState(''),[responsible,setResponsible]=useState('');
 const [receipt,setReceipt]=useState<{requestId:string;status?:string;message?:string}|null>(null);
 const inFlight=useRef(false),generation=useRef(0);
 const job=data?.appointments.find(row=>row.recordId===selected);
 const actionTruck=data?.trucks.find(value=>sameTruck(value,job?.truck)) || '';
 async function run(work:()=>Promise<void>){if(inFlight.current)return;inFlight.current=true;setBusy(true);setError('');try{await work();}catch(e){setError(e instanceof Error?e.message:'Check the saved result before retrying.');}finally{inFlight.current=false;setBusy(false);}}
 const refresh=useCallback(async()=>{const revision=++generation.current;const snapshot=await managerRequest('schedule',undefined,{date}) as Snapshot;if(revision!==generation.current)return;setData(snapshot);setPhones(null);setSelected('');setEditing(false);},[date]);
 useEffect(()=>{let active=true;void refresh().catch(e=>{if(active)setError(e.message);});return()=>{active=false;};},[refresh]); // date selects the local source snapshot
 async function change(){if(!job)return;
  let values:Record<string,unknown>={};
  if(action==='note')values={note:text};
  if(action==='cancel')values={reason:text};
  if(action==='move')values={truck,appointmentStartMinutes:Number(hour.slice(0,2))*60,durationHours:1};
  if(action==='reschedule'||action==='restore')values={destinationDate:destination,appointmentStartMinutes:Number(hour.slice(0,2))*60};
  if(action==='call_ahead')values={called:true};
  const requestId=crypto.randomUUID();setReceipt({requestId,status:'uncertain',message:'Request submitted. Check saved result before another change.'});
  const result=await managerRequest('operations',{requestId,date,recordId:job.recordId,expectedVersion:job.version,action,values});setReceipt(result.receipt);setMessage(result.receipt?.message || 'Check the saved result.');
 }
 async function context(){if(!data||!driver||!responsible)return;
  await managerRequest('context',{date:today,truck,driver,responsible,navigators:navigator?[navigator]:[],expectedVersion:data.day?.version || 0,requestId:crypto.randomUUID()});
  setMessage('Work context saved. No appointments moved. Continue to the crew workflow for inspection, photos and collected-payment closeout.');onCrew();
 }
 async function phoneAction(p:ManagedPhone,action:'authorize-live'|'revoke'){
  if(!window.confirm(`${action==='revoke'?'Revoke live access for':'Grant live access to'} ${p.label} (${p.deviceId})?`))return;
  const result=await managerRequest('phones',{action,deviceId:p.deviceId});setPhones(result.phones);setMessage('Phone access updated.');
 }
 return <main className={styles.page}><div className={styles.content}><h1>Waypoint manager</h1><p>All trucks · Appointment and phone management</p>
 <div className={styles.form}><label>Schedule date<input type="date" value={date} disabled={busy} onChange={e=>setDate(e.target.value)}/></label><button className={styles.secondary} disabled={busy} onClick={()=>void run(refresh)}>Refresh schedule</button><button className={styles.primary} disabled={busy} onClick={()=>setBooking(true)}>New appointment</button><button className={styles.secondary} disabled={busy} onClick={()=>void run(async()=>setPhones((await managerRequest('phones')).phones))}>Manage phone access</button></div>
 {error&&<p role="alert">{error}</p>}{message&&<p role="status">{message}</p>}
 {receipt&&<section className={styles.card}><h2>Saved change</h2><p>{receipt.status} · {receipt.message}</p><p>Reference: {receipt.requestId}</p><button className={styles.secondary} disabled={busy} onClick={()=>void run(async()=>{const result=await managerRequest('operations',undefined,{requestId:receipt.requestId});setReceipt(result.receipt);})}>Check saved result</button>{['verified','failed','reconciled'].includes(receipt.status || '')&&<button className={styles.secondary} disabled={busy} onClick={()=>{setReceipt(null);void run(refresh);}}>Done · Refresh schedule</button>}</section>}
 {booking&&<ManagerBooking date={date} trucks={data?.trucks || []} onClose={()=>setBooking(false)} onSaved={()=>void run(refresh)}/>}
 {phones&&<section className={styles.card}><h2>Phone access</h2><p>Live grants do not grant the manager role. Setup codes must still be enrolled securely on the device.</p>{phones.map(p=><article key={p.deviceId}><h3>{p.label}</h3><p>{p.state} · {p.access} · {truckDisplayText(p.truck)}</p><small style={{overflowWrap:'anywhere'}}>{p.deviceId}</small><div>{p.state==='active'&&p.access==='sandbox'&&<button disabled={busy} className={styles.primary} onClick={()=>void run(()=>phoneAction(p,'authorize-live'))}>Grant live access</button>}{p.state==='active'&&<button disabled={busy} className={styles.secondary} onClick={()=>void run(()=>phoneAction(p,'revoke'))}>Revoke access</button>}</div></article>)}</section>}
 <details className={`${styles.card} ${styles.form}`}><summary>Enroll a company phone</summary><p>Creates one short-lived setup code. It sends no message and grants no manager role.</p><label>Phone label<input value={text} onChange={e=>setText(e.target.value)} maxLength={80}/></label><label>Enrollment truck<select value={truck} onChange={e=>setTruck(e.target.value)}>{data?.trucks.map(t=><option key={t}>{t}</option>)}</select></label><button className={styles.secondary} disabled={busy||!text.trim()} onClick={()=>void run(async()=>{if(!window.confirm(`Create a live setup code for ${text} on ${truck}?`))return;const result=await managerRequest('phones',{action:'enroll',truck,label:text});setMessage(`Setup code: ${result.enrollment.code}. Expires ${result.enrollment.expiresAt}. Share securely with that device only.`);})}>Create setup code</button></details>
 <p className={styles.muted}>{data?.observedAt?`Source observed ${new Date(data.observedAt).toLocaleString()}`:'Source timestamp unavailable'} · {data?.appointments.length ?? 0} appointments</p>
 {!selected?data?.appointments.map(row=><section className={styles.card} key={row.recordId}><p>{row.jkNumber} · {row.appointmentTime} · {row.status}</p><h2>{row.customerName}</h2><p>{truckDisplayText(row.truck) || 'Unassigned'} · {row.address}</p><button className={styles.primary} disabled={busy} onClick={()=>{setSelected(row.recordId);setTruck(data.trucks.find(value=>sameTruck(value,row.truck)) || '');setText('');setAction('note');setDriver(data.day?.driver || '');setNavigator(data.day?.navigators[0] || '');setResponsible(data.day?.responsible || '');}}>Manage appointment</button></section>):job&&<section className={styles.card}><h2>{job.customerName}</h2><p>{job.jkNumber} · {truckDisplayText(job.truck) || 'Unassigned'} · {job.status}</p><p>{job.address}</p><p>{job.appointmentNotes.join('\n')}</p><p>Assigned crew: {job.driver || 'Not listed'} · {job.navigator || 'No navigator listed'}</p>
 <div className={styles.form}><label>Action<select disabled={busy||Boolean(receipt)} value={action} onChange={e=>setAction(e.target.value)}><option value="note">Add appointment note</option><option value="move">Assign truck / change time</option><option value="reschedule">Reschedule</option><option value="restore">Restore cancelled appointment</option><option value="cancel">Cancel appointment</option><option value="call_ahead">Mark call-ahead completed</option></select></label>
 {['note','cancel'].includes(action)&&<label>{action==='cancel'?'Cancellation reason':'Appointment note'}<textarea value={text} onChange={e=>setText(e.target.value)}/></label>}
 {action==='move'&&<label>Truck<select value={truck} onChange={e=>setTruck(e.target.value)}><option value="">Unassigned</option>{data?.trucks.map(t=><option key={t}>{t}</option>)}</select></label>}
 {['reschedule','restore'].includes(action)&&<label>Destination date<input type="date" value={destination} onChange={e=>setDestination(e.target.value)}/></label>}
 {['move','reschedule','restore'].includes(action)&&<label>Start time<input type="time" step={3600} value={hour} onChange={e=>setHour(e.target.value)}/></label>}
 <button className={styles.primary} disabled={busy||Boolean(receipt)} onClick={()=>void run(async()=>{if(window.confirm(`Apply ${action.replace('_',' ')} to ${job.jkNumber} for ${job.customerName}?`))await change();})}>Review and apply change</button></div>
 <button className={styles.secondary} disabled={busy||Boolean(receipt)} onClick={()=>setEditing(true)}>Edit appointment details</button>{editing&&<ManagerEdit job={job} date={date} onReceipt={setReceipt} onClose={()=>setEditing(false)}/>}
 <details><summary>Dispatch controls</summary><p>Release this appointment to its assigned truck, or clear that truck’s queued slot.</p><button className={styles.secondary} disabled={busy||!actionTruck} onClick={()=>void run(async()=>{const state=await managerRequest('dispatch',undefined,{truck:actionTruck,date});if(!window.confirm(`Release ${job.jkNumber} to ${job.truck}?`))return;await managerRequest('dispatch',{action:'release',truck:actionTruck,date,appointmentId:job.appointmentId,expectedJobVersion:job.version,expectedVersion:state.dispatch.version,requestId:crypto.randomUUID()});setMessage('Dispatch updated.');})}>Release assignment</button><button className={styles.secondary} disabled={busy||!actionTruck} onClick={()=>void run(async()=>{const state=await managerRequest('dispatch',undefined,{truck:actionTruck,date});if(!window.confirm(`Clear the queued assignment for ${job.truck}?`))return;await managerRequest('dispatch',{action:'clear-queued',truck:actionTruck,expectedVersion:state.dispatch.version,requestId:crypto.randomUUID()});setMessage('Queued assignment cleared.');})}>Clear queued assignment</button></details>
 {date===today&&<details><summary>Closeout and payment methods</summary><p>Confirm the actual truck and crew doing the work. This changes this phone’s work context without moving any appointments. The crew workflow retains inspection, photos, payment review and source verification.</p><div className={styles.form}><label>Work truck<select value={truck} onChange={e=>setTruck(e.target.value)}><option value="">Choose the actual work truck</option>{data?.trucks.map(t=><option key={t}>{t}</option>)}</select></label>{([['Responsible person',responsible,setResponsible],['Driver',driver,setDriver],['Navigator',navigator,setNavigator]] as const).map(([label,value,set])=><label key={label}>{label}<select value={value} onChange={e=>set(e.target.value)}><option value="">{label==='Navigator'?'No navigator':'Choose person'}</option>{data?.roster.map(name=><option key={name}>{name}</option>)}</select></label>)}<button className={styles.primary} disabled={busy||!driver||!responsible||!truck} onClick={()=>void run(context)}>Save work context · Open crew workflow</button></div></details>}
 <button className={styles.secondary} disabled={busy} onClick={()=>setSelected('')}>Back to all appointments</button></section>}
 {data&&<details className={styles.card}><summary>Stop order</summary>{orderGroups(data.appointments,'remaining').filter(group=>group.length>1).map(group=><div key={orderGroupKey(group[0],'remaining')}><h3>{truckDisplayText(group[0].truck)}</h3>{group.map((row,i)=><p key={row.recordId}>{i+1}. {row.customerName}{i>0&&<button className={styles.secondary} disabled={busy} onClick={()=>void run(async()=>{const ids=group.map(r=>r.recordId);[ids[i-1],ids[i]]=[ids[i],ids[i-1]];await managerRequest('order',{date,scope:'remaining',groupKey:orderGroupKey(group[0],'remaining'),sourceKey:orderSourceKey(group,'remaining'),ids,action:'save'});await refresh();})}>Move earlier</button>}</p>)}</div>)}</details>}
 </div></main>;
}
