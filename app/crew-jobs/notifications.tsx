'use client';
import {useCallback,useEffect,useRef,useState} from 'react';
import styles from './phone-access.module.css';
import layout from './notifications.module.css';
export type NotificationConnection='checking'|'on'|'off'|'attention';
type Message={id:string;body:string;created_at:string};
const endpoint='/api/crew-jobs/notifications';
export default function WaypointNotifications({view='all',onConnectionChange}:{view?:'all'|'notifications'|'messages';onConnectionChange?:(state:NotificationConnection)=>void}){
 const [available,setAvailable]=useState(false),[publicKey,setPublicKey]=useState(''),[messages,setMessages]=useState<Message[]>([]),[busy,setBusy]=useState(false),[status,setStatus]=useState(''),[error,setError]=useState('');
 const [supported,setSupported]=useState(false),[standalone,setStandalone]=useState(false),[enabled,setEnabled]=useState(false);
 const [checked,setChecked]=useState(false);
 useEffect(()=>{onConnectionChange?.(!checked?'checking':error?'attention':enabled?'on':'off');},[checked,error,enabled,onConnectionChange]);
 const working=useRef(false);
 const load=useCallback(async()=>{
  if(working.current)return;working.current=true;setBusy(true);
  try{
   let key='',id='';try{key=localStorage.getItem('waypoint-push-key') || '';id=localStorage.getItem('waypoint-push-device') || '';}catch{}
   const response=await fetch(endpoint,{cache:'no-store',headers:{'x-waypoint-notification-key':key,'x-waypoint-notification-device':id}}),body=await response.json();
   if(!response.ok)throw Error(body.error || 'Notifications could not be loaded.');
   setMessages(body.messages || []);setAvailable(body.available);setPublicKey(body.publicKey || '');
   const permitted='Notification' in window && Notification.permission==='granted';
   const subscription=permitted && 'serviceWorker' in navigator ? await (await navigator.serviceWorker.getRegistration('/crew-jobs'))?.pushManager.getSubscription() : null;
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
 <h1>{view==='messages'?'Office messages':view==='notifications'?'Notifications':'Notifications & office messages'}</h1>
 <div className={layout.body}>
  <section hidden={view==='messages'} className={layout.setup} aria-label="Notification status">
   <p className={layout.status}>{enabled?"Notifications are on and follow your current truck.":"Notifications are off on this phone."}</p>
   <p className={styles.muted}>Job, route and office updates for your current truck.</p>
   {!standalone && <p className={styles.muted}>On iPhone: Share → Add to Home Screen, then open Waypoint from that icon.</p>}
   {!supported && <p className={styles.muted}>Push notifications require a supported iPhone with Waypoint on the Home Screen.</p>}
   {!available && <p className={styles.muted}>Notification service is currently unavailable. Office messages can still be refreshed here.</p>}
   {!enabled && <><p className={styles.muted}>Enable once. Notifications stay on after daily setup.</p>
    <button className={`${styles.secondary} ${layout.action}`} disabled={busy || !supported || !standalone || !available} onClick={()=>void enable()}>Enable notifications</button></>}
   {status && <p role="status" className={styles.muted}>{status}</p>}

  </section>
  <section hidden={view==='notifications'} className={view==='all'?layout.inbox:layout.messages} aria-label="Office messages">
   <div className={layout.inboxHeader}>{view==='all' && <h2>Office messages</h2>}
    <button className={`${styles.secondary} ${layout.action}`} aria-label="Refresh messages" disabled={busy} onClick={()=>void load().catch(()=>setError('Messages could not be refreshed.'))}>Refresh</button>
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
