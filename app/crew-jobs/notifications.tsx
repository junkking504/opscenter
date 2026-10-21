'use client';
import {useCallback,useEffect,useState} from 'react';
import styles from './phone-access.module.css';
type Message={id:string;body:string;created_at:string};
const endpoint='/api/crew-jobs/notifications';
export default function WaypointNotifications(){
 const [available,setAvailable]=useState(false),[publicKey,setPublicKey]=useState(''),[messages,setMessages]=useState<Message[]>([]),[busy,setBusy]=useState(false),[status,setStatus]=useState(''),[error,setError]=useState('');
 const [supported,setSupported]=useState(false),[standalone,setStandalone]=useState(false),[deviceId,setDeviceId]=useState(''),[enabled,setEnabled]=useState(false);
 const load=useCallback(async()=>{let key='',id='';try{key=localStorage.getItem('waypoint-push-key') || '';id=localStorage.getItem('waypoint-push-device') || '';}catch{}const response=await fetch(endpoint,{cache:'no-store',headers:{'x-waypoint-notification-key':key,'x-waypoint-notification-device':id}}),body=await response.json();if(!response.ok)throw Error(body.error || 'Notifications could not be loaded.');setMessages(body.messages || []);setAvailable(body.available);setPublicKey(body.publicKey || '');setEnabled(body.enabled===true);},[]);
 useEffect(()=>{setSupported('serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window);setStandalone(matchMedia('(display-mode: standalone)').matches || Boolean((navigator as Navigator & {standalone?:boolean}).standalone));try{setDeviceId(localStorage.getItem('waypoint-push-device') || '');}catch{}void load().catch(()=>setError('Office messages are unavailable. Try Refresh messages.'));},[load]);
 async function enable(){setBusy(true);setError('');try{
  let notificationKey=localStorage.getItem('waypoint-push-key') || '';if(!/^[a-f0-9]{64}$/.test(notificationKey)){notificationKey=Array.from(crypto.getRandomValues(new Uint8Array(32)),b=>b.toString(16).padStart(2,'0')).join('');localStorage.setItem('waypoint-push-key',notificationKey);}
  if(!standalone)throw Error('Add Waypoint to your iPhone Home Screen, then open it there to enable notifications.');
  const permission=await Notification.requestPermission();if(permission!=='granted')throw Error('Notifications are off. Allow them in iPhone Settings for Waypoint.');
  const registration=await navigator.serviceWorker.register('/api/crew-jobs/notifications-sw.js',{scope:'/crew-jobs'});
  if(!registration.active)await new Promise<void>((resolve,reject)=>{const worker=registration.installing || registration.waiting;if(!worker)return reject(Error('Reopen Waypoint to finish notification setup.'));if(worker.state==='activated')return resolve();const timeout=setTimeout(()=>reject(Error('Notification setup timed out. Try again.')),10000);worker.addEventListener('statechange',()=>{if(worker.state==='activated'){clearTimeout(timeout);resolve();}});});
  const bytes=Uint8Array.from(atob(publicKey.replace(/-/g,'+').replace(/_/g,'/')),c=>c.charCodeAt(0));
  const subscription=await registration.pushManager.getSubscription() || await registration.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:bytes});
  const response=await fetch(endpoint,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'subscribe',subscription:subscription.toJSON(),notificationKey})}),body=await response.json();if(!response.ok)throw Error(body.error || 'Notifications were not enabled.');
  localStorage.setItem('waypoint-push-device',body.deviceId);setDeviceId(body.deviceId);setEnabled(true);setStatus('Notifications enabled for today’s truck. Enable again after daily phone setup.');
 }catch(e){setError(e instanceof Error?e.message:'Notification setup failed.');}finally{setBusy(false);}}
 async function disable(){setBusy(true);setError('');try{const response=await fetch(endpoint,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'unsubscribe',deviceId,notificationKey:localStorage.getItem('waypoint-push-key')})});if(!response.ok)throw Error('Could not disable notifications. Try again.');const registration=await navigator.serviceWorker.getRegistration('/crew-jobs');await (await registration?.pushManager.getSubscription())?.unsubscribe();localStorage.removeItem('waypoint-push-device');setDeviceId('');setEnabled(false);setStatus('Notifications disabled.');}catch(e){setError(e instanceof Error?e.message:'Could not disable.');}finally{setBusy(false);}}
 return <details className={styles.card} open={messages.length>0}><summary>Notifications &amp; office messages{messages.length?` (${messages.length})`:""}</summary>
 <p>New jobs, cancellations, schedule changes, route updates and office messages for your current truck.</p>
 {!standalone && <p>On iPhone: Share → Add to Home Screen. Open Waypoint from that icon to enable notifications.</p>}
 {!supported && <p>Push notifications require a supported iPhone with Waypoint on the Home Screen.</p>}
 {!available && <p>Notification service is currently unavailable. Office messages can still be refreshed here.</p>}
 <p>{enabled?"Notifications are on for today’s truck.":"Notifications are off for this daily connection."}</p>
 <button className={styles.secondary} disabled={busy || !supported || !standalone || !available} onClick={()=>void enable()}>Enable notifications for today</button>
 {deviceId && <button className={styles.secondary} disabled={busy} onClick={()=>void disable()}>Disable notifications</button>}
 {status && <p role="status">{status}</p>}{error && <p role="alert">{error}</p>}
 <h2>Office messages</h2><button className={styles.secondary} disabled={busy} onClick={()=>void load().catch(()=>setError('Messages could not be refreshed.'))}>Refresh messages</button>
 {messages.length?messages.map(message=><section key={message.id}><p style={{whiteSpace:'pre-wrap'}}>{message.body}</p><small>{new Date(message.created_at).toLocaleTimeString([], {hour:'numeric',minute:'2-digit'})}</small></section>):<p>No office messages for this truck today.</p>}
 </details>;
}
