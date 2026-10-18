import { useEffect, useState } from 'react';
type Device={id:string;categories:string[];expires_at:string};
const categories=['schedule','krewe','fleet'];
export function PushSettings() {
  const [hidden,setHidden]=useState(true);
  const [enabled,setEnabled]=useState(false),[key,setKey]=useState(''),[devices,setDevices]=useState<Device[]>([]);
  const [selected,setSelected]=useState(categories),[message,setMessage]=useState('Checking notification availability…'),[busy,setBusy]=useState(false);
  const [registration,setRegistration]=useState<ServiceWorkerRegistration|null>(null);
  const [supported,setSupported]=useState(false),[currentId,setCurrentId]=useState('');
  async function reload() {
    const res=await fetch('/api/push/devices',{cache:'no-store'});const body=await res.json();
    if(res.status===401 || res.status===403){setHidden(true);return false;}
    if(!res.ok)throw new Error('Notification settings unavailable.');
    setHidden(!body.enabled && !(body.devices || []).length);
    setEnabled(body.enabled);setKey(body.publicKey || '');setDevices(body.devices || []);
    const saved=localStorage.getItem('opscenter-push-device') || '';setCurrentId(saved);
    const current=(body.devices || []).find((device:Device)=>device.id===saved);if(current)setSelected(current.categories);
    const gaps=(body.health || []).filter((row:{code:string})=>row.code!=='recorded'&&row.code!=='recovered_gap');
    setMessage(body.enabled?(gaps.length?'Some notification sources are blocked; source coverage is incomplete.':!(body.health || []).length?'Notification source coverage is unknown.':(body.health || []).some((row:{code:string})=>row.code==='recovered_gap')?'Capture recovered after a recorded gap. Some earlier updates may be missing.':'Choose categories for this device.'):'Phone notifications are awaiting activation.');
    return body.enabled as boolean;
  }
  useEffect(()=>{
    let active=true;
    const available=window.isSecureContext && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
    setSupported(available);
    void reload().then(async activated=>{
      if(!available || !activated)return;
      const reg=await navigator.serviceWorker.register('/opscenter-push-sw.js',{scope:'/',updateViaCache:'none'});
      // Registration may install in the background. Permission is never requested here.
      if(!reg.active) await new Promise<void>((resolve,reject)=>{
        const worker=reg.installing || reg.waiting;
        if(!worker){reject(new Error('Notification worker unavailable.'));return;}
        const timer=setTimeout(()=>reject(new Error('Notification worker is still installing. Reload settings.')),10000);
        worker.addEventListener('statechange',()=>{if(worker.state==='activated'){clearTimeout(timer);resolve();}});
      });
      if(active)setRegistration(reg);
    }).catch(error=>{if(active)setMessage(error.message);});
    return ()=>{active=false;};
  },[]);
  async function save() {
    if(!registration || !key || !selected.length)return;
    setBusy(true);let created:PushSubscription|null=null;
    try {
      // First asynchronous operation is the explicit permission request from this tap.
      const permission=await Notification.requestPermission();
      if(permission!=='granted')throw new Error('Permission was not granted. You can change it in iPhone Settings.');
      const bytes=Uint8Array.from(atob(key.replace(/-/g,'+').replace(/_/g,'/')),c=>c.charCodeAt(0));
      let subscription=await registration.pushManager.getSubscription();
      if(!subscription){subscription=await registration.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:bytes});created=subscription;}
      const res=await fetch('/api/push/devices',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'subscribe',subscription:subscription.toJSON(),categories:selected})});
      if(!res.ok)throw new Error('Could not save this device. Refresh settings and retry.');
      const saved=await res.json();localStorage.setItem('opscenter-push-device',saved.deviceId);
      await reload();setMessage('This device is enabled. No test notification was sent.');
    } catch(error) {if(created)await created.unsubscribe().catch(()=>false);setMessage(error instanceof Error?error.message:'Could not enable notifications.');}
    finally {setBusy(false);}
  }
  async function remove(device:Device) {
    setBusy(true);
    try {
      // Server revocation first; browser unsubscribe failure cannot leave sending enabled.
      const res=await fetch('/api/push/devices',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'unsubscribe',deviceId:device.id})});
      if(!res.ok)throw new Error('Could not remove device. Refresh and retry.');
      if(device.id===currentId){localStorage.removeItem('opscenter-push-device');await (await registration?.pushManager.getSubscription())?.unsubscribe();}
      await reload();setMessage('Device disabled. Use Enable Notifications to subscribe again.');
    }catch(error){setMessage(error instanceof Error?error.message:'Could not disable device.');}finally{setBusy(false);}
  }
  if(hidden)return null;
  return <section className="push-settings" aria-label="Phone notifications">
    <h3>Phone notifications</h3><p>For iPhone, add OpsCenter to your Home Screen and open that app (iOS 16.4 or later). Apple Web Push devices only.</p>
    <fieldset disabled={busy}><legend>Updates for this device</legend>{categories.map(category=><label key={category}><input type="checkbox" checked={selected.includes(category)} onChange={event=>setSelected(event.target.checked?[...selected,category]:selected.filter(c=>c!==category))}/>{category==='krewe'?'Krewe clock changes':category==='fleet'?'Fleet arrivals and departures':'Schedule changes'}</label>)}</fieldset>
    <button type="button" disabled={busy || !enabled || !supported || !registration || !selected.length} onClick={()=>void save()}>Enable Notifications / Save Categories</button>
    <p role="status">{message}{!supported?' This browser cannot enable Web Push; open the Home Screen app.':''}</p>
    {devices.map((device,index)=><div key={device.id}>{device.id===currentId?'This device':`Device ${index+1}`} · {device.categories.join(', ')} · expires {new Date(device.expires_at).toLocaleDateString()} <button type="button" disabled={busy} onClick={()=>void remove(device)}>Disable device {index+1}</button></div>)}
    <small>Lock screen shows only that updates are available. Devices expire within 30 days or when the current login expires. Saving renews this device.</small>
  </section>;
}
