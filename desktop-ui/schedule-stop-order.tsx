import { useEffect, useRef, useState } from 'react';
import { stopGroups, stopGroupKey, stopOrderSourceKey } from '../lib/schedule-stop-order';
import type { ScheduleAppointment, ScheduleRouteLeg, ScheduleSnapshot } from './lib/schedule-contract';
import './schedule-stop-order.css';

export default function ScheduleStopOrder({snapshot,busy,saved,onBusyChange}: {snapshot: ScheduleSnapshot; busy: boolean; saved: (snapshot: ScheduleSnapshot)=>void; onBusyChange: (busy: boolean)=>void}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const groups = stopGroups(snapshot.appointments);
  const [group,setGroup] = useState<ScheduleAppointment[] | null>(null);
  const [ids,setIds] = useState<string[]>([]);
  const [legs,setLegs] = useState<ScheduleRouteLeg[]>([]);
  const [message,setMessage] = useState('');
  const [working,setWorking] = useState<'preview'|'nearest'|'save'|''>('');
  const [refresh,setRefresh] = useState(0);
  const active = useRef<AbortController | null>(null);
  const saving = useRef(false);
  const previewTimer = useRef<number | null>(null);
  const cancelPreview = () => { if (previewTimer.current !== null) window.clearTimeout(previewTimer.current); previewTimer.current = null; };
  const sourceKey = group ? stopOrderSourceKey(group) : '';
  const groupKey = group ? stopGroupKey(group[0]) : '';
  const current = groups.find(group=>stopGroupKey(group[0]) === groupKey);
  const stale = Boolean(group && (!current || stopOrderSourceKey(current) !== sourceKey));
  const draftKey = JSON.stringify(ids);
  const changed = Boolean(group && draftKey !== JSON.stringify(group.map(job=>job.recordId)));
  const choose = (next: ScheduleAppointment[]) => { if (saving.current) return; cancelPreview(); active.current?.abort(); setGroup(next); setIds(next.map(job=>job.recordId)); setLegs([]); setMessage(''); setRefresh(n=>n+1); };
  const close = () => { if (saving.current) return; cancelPreview(); active.current?.abort(); dialog.current?.close(); setGroup(null); setWorking(''); };
  const request = async (action: 'preview'|'nearest'|'save') => {
    // A debounced preview must never replace a user-requested save/suggestion.
    if (saving.current) return;
    cancelPreview();
    active.current?.abort();
    const abort = new AbortController(); active.current = abort;
    setWorking(action); setMessage('');
    if (action !== 'save') setLegs([]);
    if (action === 'save') { saving.current = true; onBusyChange(true); }
    try {
      const response = await fetch('/api/desktop/schedule/order',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify({date:snapshot.date,groupKey,sourceKey,ids,action}),signal:AbortSignal.any([abort.signal,AbortSignal.timeout(60_000)])});
      const body = await response.json().catch(()=>{throw new Error('The server response was unavailable. Try again after the schedule refreshes.');});
      if (!response.ok) throw new Error(body.error || 'Stop order unavailable.');
      if (abort.signal.aborted) return;
      if (action === 'save') { saved(body.snapshot); dialog.current?.close(); setGroup(null); }
      else { if (action === 'nearest') setIds(body.ids); setLegs(body.legs); }
    } catch (error) { if (!abort.signal.aborted) setMessage(error instanceof Error ? error.message : 'Request unavailable. Try again.'); }
    finally {
      if (action === 'save') { saving.current = false; onBusyChange(false); }
      if (!abort.signal.aborted) setWorking('');
    }
  };
  useEffect(()=>{
    cancelPreview();
    if (!group || stale) { if (!saving.current) active.current?.abort(); setLegs([]); return; }
    if (saving.current) return;
    setLegs([]);
    previewTimer.current = window.setTimeout(()=>void request('preview'),350);
    return ()=>{cancelPreview(); if (!saving.current) active.current?.abort();};
    // Only a changed draft or refreshed source should request new road legs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  },[sourceKey,draftKey,stale,refresh]);
  useEffect(()=>()=>{cancelPreview(); active.current?.abort();},[]);
  if (!groups.length && !group) return null;
  return <>
    <button type="button" className="schedule-stop-order-trigger" disabled={busy} onClick={()=>{choose(groups[0]);dialog.current?.showModal();}}>Stop Order</button>
    <dialog ref={dialog} className="schedule-stop-order" aria-labelledby="stop-order-title" onCancel={event=>{event.preventDefault();close();}}>
      <header><h2 id="stop-order-title">Order Same-Time Appointments</h2><button type="button" aria-label="Close stop order" disabled={working === 'save'} onClick={close}>×</button></header>
      <p>Move stops up or down. Times and truck assignments stay the same. Save to update the schedule and travel estimates.</p>
      {group && <>
        <label>Truck and time slot<select aria-label="Stop order time slot" value={groupKey} disabled={working === 'save'} onChange={event=>{const next=groups.find(group=>stopGroupKey(group[0]) === event.target.value);if(next)choose(next);}}>{groups.map(group=><option key={stopGroupKey(group[0])} value={stopGroupKey(group[0])}>{group[0].truck} · {group[0].appointmentTime} · {group.length} stops</option>)}</select></label>
        {stale && <p role="alert">The schedule or saved order changed. <button disabled={working === 'save'} onClick={()=>{if(current)choose(current);else close();}}>Refresh stops</button></p>}
        <ol>{ids.map((id,index)=>{
          const job=group.find(job=>job.recordId === id)!;
          const leg=legs.find(leg=>leg.toAppointmentId === id && leg.fromAppointmentId === ids[index-1]);
          return <li key={id}>
            {index > 0 && <small className="stop-order-travel">{stale ? 'Refresh stops to calculate travel' : working === 'preview' || working === 'nearest' ? 'Calculating road travel…' : leg?.travelMinutes != null ? `${leg.travelMinutes} min · ${leg.miles} mi from previous stop` : !job.location || !group.find(job=>job.recordId === ids[index-1])?.location ? 'Verify address to calculate travel' : 'Travel estimate unavailable'}</small>}
            <div className="stop-order-row"><b>{index+1}</b><div><strong>{job.jkNumber} · {job.customerName}</strong><span>{job.address}</span><small>{job.status}</small></div><div className="stop-order-arrows">{[-1,1].map(direction=><button key={direction} aria-label={`Move ${job.jkNumber} ${direction<0?'up':'down'}`} disabled={stale || working === 'save' || working === 'nearest' || index+direction<0 || index+direction>=ids.length} onClick={()=>{const next=[...ids];[next[index],next[index+direction]]=[next[index+direction],next[index]];setIds(next);}}>{direction<0?'↑':'↓'}</button>)}</div></div>
          </li>;
        })}</ol>
        <button type="button" disabled={stale || working === 'save' || working === 'nearest' || ids.length>12 || group.some(job=>!job.location)} onClick={()=>void request('nearest')}>{working === 'nearest' ? 'Finding nearest stops…' : 'Suggest nearest after first stop'}</button>
        <p>Choose your first stop with the arrows. The suggestion then follows the nearest road distance. Estimates exclude live traffic.</p>
        {message && <p role="alert">{message}</p>}
        <footer><button type="button" disabled={working === 'save'} onClick={close}>Cancel</button><button type="button" disabled={!changed || stale || working === 'save' || working === 'nearest'} onClick={()=>void request('save')}>{working === 'save' ? 'Saving…' : 'Save Order'}</button></footer>
      </>}
    </dialog>
  </>;
}
