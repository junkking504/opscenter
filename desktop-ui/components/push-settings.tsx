import { useEffect, useRef, useState } from 'react';
import type { PushJournalHealth } from '../../lib/web-push-journal-health';
import { PushJournalStatus } from './push-journal-status';
type Device={id:string;categories:string[];expires_at:string;fingerprint:string;approved:boolean};
type Trial={status:string;deadline:string|null;attemptsUsed:number;maxAttempts:number|null};
type Recovery={eligible:boolean;categories:string[];pending:{id:string;fingerprint:string;categories:string[];expires_at:string}|null};
const categories=['schedule','krewe','fleet'];
async function fingerprint(subscription: PushSubscription) {
  const s=subscription.toJSON();
  const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify([s.endpoint,s.keys?.p256dh,s.keys?.auth])));
  return Array.from(new Uint8Array(digest),n=>n.toString(16).padStart(2,'0')).join('');
}
export function PushSettings({ showUnavailable = false, onBusyChange }: { showUnavailable?: boolean; onBusyChange?: (busy: boolean) => void } = {}) {
  const [hidden,setHidden]=useState(!showUnavailable),[trial,setTrial]=useState<Trial|null>(null);
  const [journal,setJournal]=useState<PushJournalHealth|null>(null),[sender,setSender]=useState<{enabled:boolean;ready:boolean}|null>(null);
  const [recovery,setRecovery]=useState<Recovery|null>(null),[confirmed,setConfirmed]=useState(false);
  const [enabled,setEnabled]=useState(false),[enrollment,setEnrollment]=useState(false),[key,setKey]=useState(''),[devices,setDevices]=useState<Device[]>([]);
  const [selected,setSelected]=useState(categories),[message,setMessage]=useState('Checking notification availability…'),[busy,setBusy]=useState(false);
  const [registration,setRegistration]=useState<ServiceWorkerRegistration|null>(null),[supported,setSupported]=useState(false);
  const [currentId,setCurrentId]=useState(''),[currentFingerprint,setCurrentFingerprint]=useState('');
  const inFlight=useRef(false),regRef=useRef<ServiceWorkerRegistration|null>(null);
  useEffect(()=>{onBusyChange?.(busy);return()=>onBusyChange?.(false);},[busy,onBusyChange]);
  async function identify(reg:ServiceWorkerRegistration, rows:Device[]) {
    const subscription=await reg.pushManager.getSubscription();
    const hash=subscription?await fingerprint(subscription):'';
    setCurrentFingerprint(hash);
    const current=rows.find(device=>device.fingerprint===hash);
    setCurrentId(current?.id||'');
    if(current){localStorage.setItem('opscenter-push-device',current.id);setSelected(current.categories);}
  }
  async function reload() {
    const res=await fetch('/api/push/devices',{cache:'no-store'}),body=await res.json();
    if(res.status===401||res.status===403){setHidden(!showUnavailable);setEnabled(false);setEnrollment(false);setMessage('Notification settings are not available for this account.');return;}
    if(!res.ok||body.storage==='unavailable')throw Error('Notification status unavailable. Refresh status before making changes.');
    setHidden(!showUnavailable&&!body.enabled&&!(body.devices||[]).length&&!body.journal?.configured&&!body.recovery?.eligible);
    setJournal(body.journal||null);setTrial(body.trial||null);setRecovery(body.recovery||null);setSender(body.sender||null);
    setEnabled(body.enabled);setEnrollment(body.enrollmentEnabled??body.enabled);setKey(body.publicKey||'');setDevices(body.devices||[]);
    if(body.recovery?.eligible)setSelected(previous=>{const retained=previous.filter(c=>body.recovery.categories.includes(c));return retained.length?retained:body.recovery.categories;});
    if(regRef.current)await identify(regRef.current,body.devices||[]);
    const health=body.health||[],messages:string[]=[];
    if(health.some((row:{code:string;reason?:string})=>!['recorded','recovered_gap','source_unknown'].includes(row.code)&&row.reason!=='ordering_uncertain'))messages.push('Some notification sources are blocked; source coverage is incomplete.');
    if(health.some((row:{reason?:string})=>row.reason==='ordering_uncertain'))messages.push('Some notification facts are withheld because their order is uncertain. Other verified updates can still notify.');
    if(!health.length||health.some((row:{code:string})=>row.code==='source_unknown'))messages.push('Notification source coverage is unknown.');
    if(health.some((row:{code:string})=>row.code==='recovered_gap'))messages.push('Capture recovered after a recorded gap. Some earlier updates may be missing.');
    setMessage(messages.join(' ')||'Choose categories for this device.');
  }
  useEffect(()=>{
    setSupported(window.isSecureContext&&'serviceWorker' in navigator&&'PushManager' in window&&'Notification' in window);
    void reload().catch(error=>{setMessage(error.message);setHidden(!showUnavailable);});
  // Initial load only; refresh is an explicit read action.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  },[]);
  useEffect(()=>{
    if(!supported||!enrollment)return;
    let active=true;
    void(async()=>{
      const reg=await navigator.serviceWorker.register('/opscenter-push-sw.js',{scope:'/',updateViaCache:'none'});await reg.update();
      if(!reg.active)await new Promise<void>((resolve,reject)=>{
        const worker=reg.installing||reg.waiting;if(!worker){reject(Error('Notification worker unavailable.'));return;}
        const timer=setTimeout(()=>reject(Error('Notification worker is still installing. Reload settings.')),10000);
        worker.addEventListener('statechange',()=>{if(worker.state==='activated'){clearTimeout(timer);resolve();}});
      });
      if(active){regRef.current=reg;setRegistration(reg);await identify(reg,devices);}
    })().catch(error=>{if(active)setMessage(error.message);});
    return()=>{active=false;};
  // Device rows are refreshed by reload; do not reinstall the worker after each read.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  },[supported,enrollment]);
  async function save() {
    if(inFlight.current||!registration||!key||!selected.length||recovery?.eligible&&!confirmed)return;
    inFlight.current=true;setBusy(true);
    try {
      const permission=await Notification.requestPermission();
      if(permission!=='granted')throw Error('Permission was not granted. No authorization was changed. Check OpsCenter notification permission in iPhone Settings.');
      const bytes=Uint8Array.from(atob(key.replace(/-/g,'+').replace(/_/g,'/')),c=>c.charCodeAt(0));
      let subscription=await registration.pushManager.getSubscription();
      if(!subscription)subscription=await registration.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:bytes});
      const action=recovery?.eligible?'request-reenable':'subscribe';
      const res=await fetch('/api/push/devices',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action,confirm:action==='request-reenable',subscription:subscription.toJSON(),categories:selected})});
      if(!res.ok)throw Error('Could not save this request. Refresh status before retrying. Your phone has not been newly authorized.');
      await res.json();setCurrentFingerprint(await fingerprint(subscription));await reload();
      setConfirmed(false);
      setMessage(action==='request-reenable'?'Request saved. Notifications remain disabled until the owner verifies and authorizes this exact phone. No test was sent.':'Device saved. It must be explicitly verified and approved before notifications can send. No test notification was sent.');
    }catch(error){
      // A lost response can follow a committed request. Keep the browser subscription
      // so an explicit status refresh/retry can reconcile the same fingerprint.
      setMessage(error instanceof Error?error.message:'Could not save notifications.');
    }finally{inFlight.current=false;setBusy(false);}
  }
  async function remove(device:Device) {
    if(inFlight.current)return;inFlight.current=true;setBusy(true);
    try {
      const res=await fetch('/api/push/devices',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'unsubscribe',deviceId:device.id})});
      if(!res.ok)throw Error('Could not disable device. Refresh status before retrying.');
      if(device.id===currentId){localStorage.removeItem('opscenter-push-device');await(await registration?.pushManager.getSubscription())?.unsubscribe();}
      await reload();setConfirmed(false);setMessage('Device disabled. Re-enabling requires a new request and explicit owner authorization.');
    }catch(error){setMessage(error instanceof Error?error.message:'Could not disable device.');}finally{inFlight.current=false;setBusy(false);}
  }
  if(hidden)return null;
  const pending=recovery?.pending?.fingerprint===currentFingerprint?recovery.pending:null;
  return <section className="push-settings" aria-label="Phone notifications">
    <h3>Phone notifications</h3><p>For iPhone, add OpsCenter to your Home Screen and open that app (iOS 16.4 or later). Apple Web Push devices only.</p>
    {sender&&<p>Alert service: {!sender.enabled?'off':sender.ready?'running':'paused'}. {sender.enabled&&!sender.ready?'The sender must be resumed before notifications can send.':''}</p>}
    {trial?.status==='ongoing_revoked'&&<p><strong>Phone authorization: revoked.</strong> iPhone notification permission is separate. Request re-enablement below; this does not restore authorization automatically.</p>}
    {trial&&['ongoing_expired','stopped','not_allowed'].includes(trial.status)&&<p>Phone authorization: {trial.status.replaceAll('_',' ')}. Owner authorization is required before enrollment can resume.</p>}
    <fieldset disabled={busy}><legend>Updates for this device</legend>{categories.map(category=><label key={category}><input type="checkbox" disabled={Boolean(recovery?.eligible&&!recovery.categories.includes(category))} checked={selected.includes(category)} onChange={event=>setSelected(event.target.checked?[...selected,category]:selected.filter(c=>c!==category))}/>{category==='krewe'?'Krewe clock changes':category==='fleet'?'Fleet arrivals and departures':'Schedule changes'}</label>)}</fieldset>
    {recovery?.eligible&&<label><input type="checkbox" checked={confirmed} disabled={busy} onChange={event=>setConfirmed(event.target.checked)}/>I want to re-enable notifications on this phone, within the existing authorization expiry.</label>}
    <button type="button" disabled={busy||!(enabled||enrollment&&recovery?.eligible)||!supported||!registration||!selected.length||Boolean(recovery?.eligible&&!confirmed)} onClick={()=>void save()}>{recovery?.eligible?'Request re-enable for this phone':'Enable Notifications / Save Categories'}</button>
    <p role="status">{message}{!supported?' This browser cannot enable Web Push; open the Home Screen app.':''}</p>
    {pending&&<div><strong>Awaiting owner authorization for this phone</strong><p>Share the request ID and fingerprint with the owner for verification. Request expires {new Date(pending.expires_at).toLocaleString()}. Then tap Refresh status.</p><small>Request ID: <code style={{overflowWrap:'anywhere'}}>{pending.id}</code><br/>Fingerprint: <code style={{overflowWrap:'anywhere'}}>{pending.fingerprint}</code></small></div>}
    {trial&&trial.maxAttempts===null?<p>Ongoing notifications: {trial.status==='ongoing'?(enabled?'enabled':'paused'):trial.status==='ongoing_revoked'?'disabled for this phone':trial.status.replaceAll('_',' ')}{trial.deadline?` · authorization limit ${new Date(trial.deadline).toLocaleString()}`:''}</p>:trial&&<p>Trial: {trial.status.replaceAll('_',' ')} · {trial.attemptsUsed}/{trial.maxAttempts} send attempts used{trial.deadline?` · ends ${new Date(trial.deadline).toLocaleString()}`:' · clock has not started'}</p>}
    {devices.map((device,index)=><div key={device.id}>{device.id===currentId?'This device':`Device ${index+1}`} · {device.categories.join(', ')} · {device.approved?'Device approved':'Awaiting device approval'} · expires {new Date(device.expires_at).toLocaleString()} <button type="button" disabled={busy} onClick={()=>void remove(device)}>Disable device {index+1}</button>{device.id===currentId&&<div><small>Device verification ID: {device.id}<br/>Fingerprint: <code style={{overflowWrap:'anywhere'}}>{device.fingerprint}</code></small></div>}</div>)}
    <PushJournalStatus health={journal}/>
    <button type="button" disabled={busy} onClick={()=>{if(inFlight.current)return;inFlight.current=true;setBusy(true);void reload().catch(()=>{setEnabled(false);setEnrollment(false);setJournal(null);setMessage('Notification status unavailable.');}).finally(()=>{inFlight.current=false;setBusy(false);});}}>Refresh status</button>
    <small>{!trial?'Notification status must be available before device settings can be saved.':trial.maxAttempts===null?'Only subsequent recorded changes notify after authorization. No old alerts are replayed. Device expiry and Disable device stop later sends.':'The trial requires separate approval of this exact device and permits three send attempts total. Saving does not restart or extend it.'} Apple acceptance is not confirmation that a notification appeared on this phone.</small>
  </section>;
}
