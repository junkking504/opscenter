import { useEffect, useRef, useState } from 'react';
import type { PushJournalHealth } from '../../lib/web-push-journal-health';
import { PushJournalStatus } from './push-journal-status';
type Device={id:string;categories:string[];expires_at:string|null;consented_at?:string|null;fingerprint:string;approved:boolean};
const categories=['schedule','krewe','fleet'];
async function fingerprint(subscription: PushSubscription) {
  const s=subscription.toJSON();
  const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify([s.endpoint,s.keys?.p256dh,s.keys?.auth])));
  return Array.from(new Uint8Array(digest),n=>n.toString(16).padStart(2,'0')).join('');
}
export function PushSettings({ showUnavailable = false, onBusyChange }: { showUnavailable?: boolean; onBusyChange?: (busy: boolean) => void } = {}) {
  const [hidden,setHidden]=useState(!showUnavailable);
  const [journal,setJournal]=useState<PushJournalHealth|null>(null),[sender,setSender]=useState<{enabled:boolean;ready:boolean}|null>(null);
  const [enabled,setEnabled]=useState(false),[enrollment,setEnrollment]=useState(false),[key,setKey]=useState(''),[devices,setDevices]=useState<Device[]>([]);
  const [selected,setSelected]=useState(categories),[message,setMessage]=useState('Checking notification availability…'),[busy,setBusy]=useState(false);
  const [registration,setRegistration]=useState<ServiceWorkerRegistration|null>(null),[supported,setSupported]=useState(false);
  const [currentId,setCurrentId]=useState('');
  function selectCategories(value:string[]) {setSelected(value);try{localStorage.setItem('opscenter-push-categories',JSON.stringify(value));}catch{/* preference storage is optional */}}
  const inFlight=useRef(false),regRef=useRef<ServiceWorkerRegistration|null>(null);
  useEffect(()=>{onBusyChange?.(busy);return()=>onBusyChange?.(false);},[busy,onBusyChange]);
  async function identify(reg:ServiceWorkerRegistration, rows:Device[]) {
    const subscription=await reg.pushManager.getSubscription();
    const hash=subscription?await fingerprint(subscription):'';
    const current=rows.find(device=>device.fingerprint===hash);
    setCurrentId(current?.id||'');
    if(current){localStorage.setItem('opscenter-push-device',current.id);selectCategories(current.categories);}
  }
  async function reload() {
    const res=await fetch('/api/push/devices',{cache:'no-store'}),body=await res.json();
    if(res.status===401||res.status===403){setHidden(!showUnavailable);setEnabled(false);setEnrollment(false);setMessage('Notification settings are not available for this account.');return;}
    if(!res.ok||body.storage==='unavailable')throw Error('Notification status unavailable. Refresh status before making changes.');
    setHidden(!showUnavailable&&!body.enabled&&!(body.devices||[]).length&&!body.journal?.configured);
    setJournal(body.journal||null);setSender(body.sender||null);
    setEnabled(body.enabled);setEnrollment(body.enrollmentEnabled??body.enabled);setKey(body.publicKey||'');setDevices(body.devices||[]);
    if(regRef.current)await identify(regRef.current,body.devices||[]);
    const health=body.health||[],messages:string[]=[];
    if(health.some((row:{code:string;reason?:string})=>!['recorded','recovered_gap','source_unknown'].includes(row.code)&&row.reason!=='ordering_uncertain'))messages.push('Some notification sources are blocked; source coverage is incomplete.');
    if(health.some((row:{reason?:string})=>row.reason==='ordering_uncertain'))messages.push('Some notification facts are withheld because their order is uncertain. Other verified updates can still notify.');
    if(!health.length||health.some((row:{code:string})=>row.code==='source_unknown'))messages.push('Notification source coverage is unknown.');
    if(health.some((row:{code:string})=>row.code==='recovered_gap'))messages.push('Capture recovered after a recorded gap. Some earlier updates may be missing.');
    setMessage(messages.join(' ')||'Choose categories for this device.');
  }
  useEffect(()=>{
    try{const saved=JSON.parse(localStorage.getItem('opscenter-push-categories')||'null');if(Array.isArray(saved)&&saved.every(value=>categories.includes(value)))setSelected(saved);}catch{/* ignore invalid local preference */}
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
    if(inFlight.current||!registration||!key||!selected.length)return;
    inFlight.current=true;setBusy(true);
    try {
      const permission=Notification.permission==='granted'?'granted':await Notification.requestPermission();
      if(permission!=='granted')throw Error('Permission was not granted. No authorization was changed. Check OpsCenter notification permission in iPhone Settings.');
      const bytes=Uint8Array.from(atob(key.replace(/-/g,'+').replace(/_/g,'/')),c=>c.charCodeAt(0));
      let subscription=await registration.pushManager.getSubscription();
      if(!subscription)subscription=await registration.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:bytes});
      const action='enable';
      const res=await fetch('/api/push/devices',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action,confirm:true,subscription:subscription.toJSON(),categories:selected})});
      const result=await res.json();
      if(res.status===409&&result.error==='subscription_invalid'){await subscription.unsubscribe();await reload();throw Error('This browser subscription is no longer valid. Tap On again to create a new one.');}
      if(!res.ok)throw Error('Could not confirm the change. Refresh status before retrying.');
      await reload();
      setMessage('Notifications are on for this phone until you turn them off or the browser revokes the subscription. No old alerts are replayed.');
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
      let browserCleanupFailed=false;
      if(device.id===currentId){localStorage.removeItem('opscenter-push-device');try{await(await registration?.pushManager.getSubscription())?.unsubscribe();}catch{browserCleanupFailed=true;}}
      await reload();setMessage('Notifications are off for this device.'+(browserCleanupFailed?' Browser cleanup was unavailable; server delivery is stopped.':''));
    }catch(error){setMessage(error instanceof Error?error.message:'Could not disable device.');}finally{inFlight.current=false;setBusy(false);}
  }
  if(hidden)return null;
  const current=devices.find(device=>device.id===currentId);
  const on=Boolean(current?.approved&&current.consented_at);
  return <section className="push-settings" aria-label="Phone notifications">
    <h3>Phone notifications</h3><p>For iPhone, open OpsCenter from your Home Screen. iPhone notification permission still applies.</p>
    {sender&&<p>Alert service: {!sender.enabled?'off':sender.ready?'running':'paused'}. {!sender.enabled||!sender.ready?'Your device preference is saved separately; delivery resumes when the service is available.':''}</p>}
    <button type="button" className="push-device-toggle" role="switch" aria-label="Notifications on this phone" aria-checked={on}
      disabled={busy||(!on&&(!enabled||!supported||!registration||!selected.length))}
      onClick={()=>void(on&&current?remove(current):save())}>
      <span>Notifications on this phone</span><span className="push-toggle-state">{on?'On':'Off'}<span className="push-toggle-track" aria-hidden="true"><span/></span></span>
    </button>
    {supported&&Notification.permission==='denied'&&<p>iPhone/browser notification permission is blocked. Saved device settings cannot override it.</p>}
    <p>Stays on until you turn it off.</p>
    <fieldset disabled={busy}><legend>Updates for this device</legend>{categories.map(category=><label key={category}><input type="checkbox" checked={selected.includes(category)} onChange={event=>selectCategories(event.target.checked?[...selected,category]:selected.filter(c=>c!==category))}/>{category==='krewe'?'Krewe clock changes':category==='fleet'?'Fleet arrivals and departures':'Schedule changes'}</label>)}</fieldset>
    {on&&<button type="button" disabled={busy||!enabled||!selected.length} onClick={()=>void save()}>Save categories</button>}
    <p role="status">{message}{!supported?' This browser cannot enable Web Push; open the Home Screen app.':''}</p>
    {current&&!current.consented_at&&<p>This phone has a legacy authorization. Turn the toggle on to use the new persistent preference.</p>}
    {devices.filter(device=>device.id!==currentId).map((device,index)=><div key={device.id}>Other device {index+1} · {device.categories.join(', ')} <button type="button" disabled={busy} onClick={()=>void remove(device)}>Turn off other device {index+1}</button></div>)}
    <PushJournalStatus health={journal}/>
    <button type="button" disabled={busy} onClick={()=>{if(inFlight.current)return;inFlight.current=true;setBusy(true);void reload().catch(()=>{setEnabled(false);setEnrollment(false);setJournal(null);setMessage('Notification status unavailable.');}).finally(()=>{inFlight.current=false;setBusy(false);});}}>Refresh status</button>
    <small>Only new changes notify after enabling. Turning off stops later sends; a notification already sent may still arrive. Apple acceptance is not confirmation that a notification appeared on this phone.</small>
  </section>;
}
