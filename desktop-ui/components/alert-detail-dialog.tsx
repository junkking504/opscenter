import { useEffect, useRef } from 'react';
import type { DesktopAlert, DesktopLiveProps } from '../lib/live-contract';
import { crewAlertContext } from '../lib/crew-alert-context';
import { AlertPhotos } from './alert-details';
import '../alert-navigation.css';

export function AlertDetailDialog({alert, href, close, snapshot}: {alert:DesktopAlert; href?:string; close:()=>void; snapshot?:DesktopLiveProps['snapshot']}) {
  const dialog=useRef<HTMLDialogElement>(null);
  const previous=useRef<HTMLElement|null>(null);
  useEffect(()=>{
    previous.current=document.activeElement as HTMLElement;
    const node=dialog.current; node?.showModal();
    return ()=>{node?.close(); previous.current?.isConnected && previous.current.focus({preventScroll:true});};
  },[]);
  const job=snapshot?.crewProgress?.jobs.find(item=>item.updateIds.includes(alert.id));
  const extra=alert.label==='New Appointment' ? job?.customerFacts || [] : crewAlertContext(alert,job);
  const facts=[...alert.facts,...extra.filter(fact=>!alert.facts.some(existing=>existing.label===fact.label && existing.value===fact.value))];
  return <dialog ref={dialog} className="alert-detail-dialog" aria-labelledby="alert-detail-title" onCancel={event=>{event.preventDefault();close();}} onClick={event=>{if(event.target===event.currentTarget)close();}}>
    <header><span>{alert.label} · {alert.detected}</span><button type="button" onClick={close} aria-label="Close alert details">×</button></header>
    <div className="alert-detail-body"><h2 id="alert-detail-title">{href ? <a href={href}>{alert.title}<span aria-hidden="true"> ↗</span></a> : alert.title}</h2>
    {alert.detail && <p>{alert.detail}</p>}
    <dl>{facts.map((fact,index)=><div key={index}><dt>{fact.label}</dt><dd>{fact.href ? <a href={fact.href}>{fact.value}</a> : fact.value}</dd></div>)}</dl>
    {alert.context && <p>{alert.context}</p>}{job?.needsFollowUp && <p><strong>Current job follow-up:</strong> {job.next}</p>}<AlertPhotos photos={alert.photos}/>
    <small>{alert.source} · {alert.owner}</small></div>
  </dialog>;
}
