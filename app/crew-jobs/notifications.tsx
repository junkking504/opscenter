'use client';
import {useCallback,useEffect,useRef,useState} from 'react';
import styles from './phone-access.module.css';
import layout from './notifications.module.css';
import {waypointUpdateLabels,waypointJobChanges,waypointJobChangeLabel,type WaypointUpdateCounts,type WaypointJobChange} from '@/lib/waypoint-update-context';
export type NotificationConnection='checking'|'on'|'off'|'attention';
type Message={id:string;body:string;created_at:string};
const endpoint='/api/crew-jobs/notifications';
export default function WaypointNotifications({view='all',onConnectionChange,onView,jobs=[],onJob}:{view?:'all'|'notifications'|'messages';onConnectionChange?:(state:NotificationConnection)=>void;onView?:(view:'route'|'messages')=>void;jobs?:Array<{appointmentId:string;jkNumber:string;customerName:string}>;onJob?:(id:string)=>void}){
 const [available,setAvailable]=useState(false),[publicKey,setPublicKey]=useState(''),[messages,setMessages]=useState<Message[]>([]),[busy,setBusy]=useState(false),[status,setStatus]=useState(''),[error,setError]=useState('');
 const [supported,setSupported]=useState(false),[standalone,setStandalone]=useState(false),[enabled,setEnabled]=useState(false);
 const [checked,setChecked]=useState(false);
 const [updates,setUpdates]=useState<Array<{id:string;counts:WaypointUpdateCounts;changes?:WaypointJobChange[];created_at:string}>>([]);
 const [selectedUpdate,setSelectedUpdate]=useState('');
 useEffect(()=>{if(selectedUpdate&&view!=='messages')document.getElementById(`truck-update-${selectedUpdate}`)?.scrollIntoView({block:'start'});},[selectedUpdate,updates,view]);
 useEffect(()=>{onConnectionChange?.(!checked?'checking':error?'attention':enabled?'on':'off');},[checked,error,enabled,onConnectionChange]);
 const working=useRef(false);
 const load=useCallback(async()=>{
  if(working.current)return;working.current=true;setBusy(true);
  try{
   let key='',id='';try{key=localStorage.getItem('waypoint-push-key') || '';id=localStorage.getItem('waypoint-push-device') || '';}catch{}
   const update=new URLSearchParams(window.location.search).get('update')||'';
   const selected=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(update)?update:'';setSelectedUpdate(selected);
   const response=await fetch(endpoint+(selected?`?update=${selected}`:''),{cache:'no-store',headers:{'x-waypoint-notification-key':key,'x-waypoint-notification-device':id}}),body=await response.json();
   if(!response.ok)throw Error(body.error || 'Notifications could not be loaded.');
   setMessages(body.messages || []);setUpdates(body.updates || []);setAvailable(body.available);setPublicKey(body.publicKey || '');
   const permitted='Notification' in window && Notification.permission==='granted';
   const registration=permitted && 'serviceWorker' in navigator ? await navigator.serviceWorker.getRegistration('/crew-jobs') : null;
   // Refresh notification routing code without changing consent or subscriptions.
   if(registration?.update)void registration.update().catch(()=>{});
   const subscription=await registration?.pushManager.getSubscription();
   let connected=body.enabled===true && Boolean(subscription);
   if(body.available && key && id && subscription){
    // Reuse the permission and subscription already granted on this browser. No prompt.
    try{
     const restored=await fetch(endpoint,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'restore',deviceId:id,notificationKey:key,endpoint:subscription.endpoint})});
     const result=await restored.json();if(!restored.ok)throw Error('Reconnect failed.');
     connected=result.enabled===true;
    }catch{setEnabled(false);setError('Office messages are up to date. Notifications could not reconnect; try Refresh.');return;}
   }
   setEnabled(connected);setError('');
  }finally{working.current=false;setBusy(false);setChecked(true);}
 },[]);
 useEffect(()=>{
  setSupported('serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window);setStandalone(matchMedia('(display-mode: standalone)').matches || Boolean((navigator as Navigator & {standalone?:boolean}).standalone));
  const refresh=()=>void load().catch(()=>setError('Notifications and office messages could not refresh. Try Refresh.'));
  const visible=()=>{if(document.visibilityState==='visible')refresh();};
  refresh();document.addEventListener('visibilitychange',visible);
  return()=>document.removeEventListener('visibilitychange',visible);
 },[load]);
 async function enable(){if(working.current)return;working.current=true;setBusy(true);setError('');try{
  let notificationKey=localStorage.getItem('waypoint-push-key') || '';if(!/^[a-f0-9]{64}$/.test(notificationKey)){notificationKey=Array.from(crypto.getRandomValues(new Uint8Array(32)),b=>b.toString(16).padStart(2,'0')).join('');localStorage.setItem('waypoint-push-key',notificationKey);}
  if(!standalone)throw Error('Add Waypoint to your iPhone Home Screen, then open it there to enable notifications.');
  const permission=await Notification.requestPermission();if(permission!=='granted')throw Error('Notifications are off. Allow them in iPhone Settings for Waypoint.');
  const registration=await navigator.serviceWorker.register('/api/crew-jobs/notifications-sw.js',{scope:'/crew-jobs'});
  if(!registration.active)await new Promise<void>((resolve,reject)=>{const worker=registration.installing || registration.waiting;if(!worker)return reject(Error('Reopen Waypoint to finish notification setup.'));if(worker.state==='activated')return resolve();const timeout=setTimeout(()=>reject(Error('Notification setup timed out. Try again.')),10000);worker.addEventListener('statechange',()=>{if(worker.state==='activated'){clearTimeout(timeout);resolve();}});});
  const bytes=Uint8Array.from(atob(publicKey.replace(/-/g,'+').replace(/_/g,'/')),c=>c.charCodeAt(0));
  const subscription=await registration.pushManager.getSubscription() || await registration.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:bytes});
  const response=await fetch(endpoint,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'subscribe',subscription:subscription.toJSON(),notificationKey})}),body=await response.json();if(!response.ok)throw Error(body.error || 'Notifications were not enabled.');
  localStorage.setItem('waypoint-push-device',body.deviceId);setEnabled(true);setStatus('Notifications enabled.');
 }catch(e){setError(e instanceof Error?e.message:'Notification setup failed.');}finally{working.current=false;setBusy(false);setChecked(true);}}
 return <section id="waypoint-office-messages" className={`${styles.card} ${layout.panel}`}>
 <h1>{view==='messages'?'Office Messages':view==='notifications'?'Notifications':'Notifications & office messages'}</h1>
 <div className={layout.body}>
  {view!=='messages' && <section className={layout.messages} aria-label="Recent Truck Updates">
   <h2>Recent Truck Updates</h2>
   <p className={styles.muted}>Changes for this company phone’s selected truck. Routine refreshes and completed jobs do not send alerts.</p>
   {selectedUpdate && checked && !updates.some(update=>update.id===selectedUpdate) && <p role="status">That notification is no longer available for today’s connected phone and truck. Check the current route or office messages below.</p>}
   {updates.length?updates.map(update=><article id={`truck-update-${update.id}`} className={`${layout.message} ${update.id===selectedUpdate?layout.selected:''}`} key={update.id}>
    {update.id===selectedUpdate&&<strong>Opened from notification</strong>}
    <ul>{(waypointUpdateLabels(update.counts).length?waypointUpdateLabels(update.counts):['Truck update · open the route or office messages']).map(label=><li key={label}>{label}</li>)}</ul>
    {waypointJobChanges(update.changes).map((change,index)=>{const job=jobs.find(job=>job.appointmentId===change.appointmentId);return <div className={layout.change} key={`${change.appointmentId}-${change.kind}-${index}`}>
     <strong>{job?`${job.jkNumber} · ${job.customerName}`:`Appointment ${change.appointmentId}`}</strong><p>{waypointJobChangeLabel(change)}</p>
     {job&&onJob?<button className={`${styles.secondary} ${layout.action}`} onClick={()=>onJob(change.appointmentId)}>Open {job.jkNumber}</button>:<p className={styles.muted}>Not available on this truck’s current route.</p>}
    </div>;})}
    {update.counts.messages>0&&onView&&<button className={`${styles.secondary} ${layout.action}`} onClick={()=>onView('messages')}>Read office messages</button>}
    <time dateTime={update.created_at}>{new Date(update.created_at).toLocaleTimeString([], {hour:'numeric',minute:'2-digit'})}</time></article>):<p className={styles.muted}>No recent update details for this phone. Check the current route and office messages.</p>}
   {onView&&<div><button className={styles.secondary} onClick={()=>onView('route')}>View current route</button><button className={styles.secondary} onClick={()=>onView('messages')}>Open office inbox</button></div>}
  </section>}
  <section hidden={view==='messages'} className={layout.setup} aria-label="Notification status">
   <p className={layout.status}>{enabled?"Notifications are on and follow your current truck.":"Notifications are off on this phone."}</p>
   <p className={styles.muted}>New or removed jobs, time and route changes, and office messages for your current truck.</p>
   {!standalone && <p className={styles.muted}>On iPhone: Share → Add to Home Screen, then open Waypoint from that icon.</p>}
   {!supported && <p className={styles.muted}>Push notifications require a supported iPhone with Waypoint on the Home Screen.</p>}
   {!available && <p className={styles.muted}>Notification service is currently unavailable. office messages can still be refreshed here.</p>}
   {!enabled && <><p className={styles.muted}>Enable once. Notifications stay on after daily setup.</p>
    <button className={`${styles.secondary} ${layout.action}`} disabled={busy || !supported || !standalone || !available} onClick={()=>void enable()}>Enable notifications</button></>}
   {status && <p role="status" className={styles.muted}>{status}</p>}

  </section>
  <section hidden={view==='notifications'} className={view==='all'?layout.inbox:layout.messages} aria-label="Office Messages">
   <div className={layout.inboxHeader}>{view==='all' && <h2>Office Messages</h2>}
    <button className={`${styles.secondary} ${layout.action}`} aria-label="Refresh Messages" disabled={busy} onClick={()=>void load().catch(()=>setError('Messages could not be refreshed.'))}>Refresh</button>
   </div>
   {messages.length?<div className={layout.messages}>{messages.map(message=><article key={message.id} className={layout.message}>
    <p style={{whiteSpace:'pre-wrap'}}>{message.body}</p><time dateTime={message.created_at}>{new Date(message.created_at).toLocaleTimeString([], {hour:'numeric',minute:'2-digit'})}</time>
   </article>)}</div>:<p className={styles.muted}>No office messages for this truck today.</p>}
  </section>
 </div>
  {view==='notifications' && <button className={`${styles.secondary} ${layout.action}`} disabled={busy} onClick={()=>void load().catch(()=>setError('Notifications could not be refreshed.'))}>Refresh notifications</button>}
  {error && <p role="alert" className={styles.error}>{error}</p>}
 </section>;
}
