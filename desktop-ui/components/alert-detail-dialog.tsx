import { useEffect, useRef } from 'react';
import type { DesktopAlert, DesktopLiveProps } from '../lib/live-contract';
import { requiresAlertAttention } from '../lib/alert-attention';
import { crewAlertContext } from '../lib/crew-alert-context';
import { AlertPhotos } from './alert-details';
import '../alert-navigation.css';

export function AlertDetailDialog({alert:openedAlert, href, close, live, openControl}: {alert:DesktopAlert; href?:string; close:()=>void; live?:DesktopLiveProps; openControl:()=>void}) {
  const current=live?.snapshot.alerts.find(item=>item.id===openedAlert.id);
  const alert=current || openedAlert;
  const blocked=!live?.snapshot.sources.workflow || Boolean(live?.pendingAlertId);
  const dialog=useRef<HTMLDialogElement>(null);
  const previous=useRef<HTMLElement|null>(null);
  useEffect(()=>{
    previous.current=document.activeElement as HTMLElement;
    const node=dialog.current; node?.showModal();
    return ()=>{node?.close(); previous.current?.isConnected && previous.current.focus({preventScroll:true});};
  },[]);
  const job=live?.snapshot.crewProgress?.jobs.find(item=>item.updateIds.includes(alert.id));
  const extra=alert.label==='New Appointment' ? job?.customerFacts || [] : crewAlertContext(alert,job);
  const facts=[...alert.facts,...extra.filter(fact=>!alert.facts.some(existing=>existing.label===fact.label && existing.value===fact.value))];
  return <dialog ref={dialog} className="alert-detail-dialog" aria-labelledby="alert-detail-title" onCancel={event=>{event.preventDefault();close();}} onClick={event=>{if(event.target===event.currentTarget)close();}}>
    <header><span>{alert.label} · {alert.detected}</span><button type="button" onClick={close} aria-label="Close alert details">×</button></header>
    <div className="alert-detail-body"><h2 id="alert-detail-title">{href ? <a href={href}>{alert.title}<span aria-hidden="true"> ↗</span></a> : alert.title}</h2>
    {alert.detail && <p>{alert.detail}</p>}
    <dl>{facts.map((fact,index)=><div key={index}><dt>{fact.label}</dt><dd>{fact.href ? <a href={fact.href}>{fact.value}</a> : fact.value}</dd></div>)}</dl>
    {alert.context && <p>{alert.context}</p>}{job?.needsFollowUp && <p><strong>Current job follow-up:</strong> {job.next}</p>}<AlertPhotos photos={alert.photos}/>
    <small>{alert.source} · {alert.owner}</small>
    {current && live && <footer className="alert-detail-actions">
      {alert.workflowState==='active' && requiresAlertAttention(alert) && <button type="button" disabled={blocked} onClick={()=>void live.onAlertAction(alert.id,'acknowledge')}>Mark reviewed</button>}
      {alert.workflowState==='in-control' ? <button type="button" onClick={openControl}>Open Control</button> : alert.workflowState!=='resolved' && <button type="button" disabled={blocked} onClick={()=>void live.onAlertAction(alert.id,'add_to_control')}>Follow up in Control</button>}
      {!live.snapshot.sources.workflow && <p role="status">Review and follow-up unavailable: Control is disconnected.</p>}
      {live.error && <p role="status">{live.error}</p>}
    </footer>}</div>
  </dialog>;
}
