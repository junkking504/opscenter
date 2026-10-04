import {useEffect,useId,useLayoutEffect,useRef,useState, type CSSProperties} from 'react';
import {truckDisplayText} from '../lib/junkware-trucks';
import {appointmentColorClass,appointmentStatus,scheduleBoardJobs,scheduleDisplayTruck,scheduleStatusTone,timelinePlacement,truckLabel,type ScheduleAppointment,type ScheduleSnapshot,type ScheduleRouteLeg,type ScheduleOperationalStop,type MoveProposal,scheduleMoveRestriction,scheduleMoveWindow} from './lib/schedule-contract';
import {scheduleTravelLayout} from './lib/schedule-travel-layout';
import {groupNearbyHqStops} from './lib/schedule-recorded-sequence';
import {DumpTruckGlyph} from './schedule-operational-stop';
import './mobile-schedule-overview.css';
import {useMobileScheduleDrag} from './mobile-schedule-drag';
import {scheduleMoveProposal} from './schedule-drag';
const clock=(m:number)=>new Date(Date.UTC(2000,0,1,0,Math.floor(m))).toLocaleTimeString('en-US',{timeZone:'UTC',hour:'numeric',minute:'2-digit'});
const hour=(m:number)=>`${Math.floor(m/60)%12||12}${Math.floor(m/60)%24<12?'a':'p'}`;
const mark=(tone:string)=>tone==='completed'?'✓':tone==='canceled'?'×':tone==='on-site'||tone==='at-job'?'●':tone==='visited'?'?':'';
export default function MobileScheduleOverview({snapshot,jobs,trucks,range,legs,now,selected,select,busy,onMove}:{snapshot:ScheduleSnapshot;jobs:ScheduleAppointment[];trucks:string[];range:{start:number;end:number;duration:number};legs:ScheduleRouteLeg[];now:number;selected:string|null;select:(id:string)=>void;busy:boolean;onMove:(move:MoveProposal)=>void}) {
 const ref=useRef<HTMLDivElement>(null),id=useId();
 const [width,setWidth]=useState(240),[viewportHeight,setViewportHeight]=useState(650),[detailTruck,setDetailTruck]=useState<string|null>(null);
 useLayoutEffect(()=>{const node=ref.current;if(!node)return;const measure=()=>{setWidth(Math.max(1,node.clientWidth-72));setViewportHeight(window.innerHeight);};const observer=new ResizeObserver(measure);observer.observe(node);window.addEventListener('resize',measure);measure();return()=>{observer.disconnect();window.removeEventListener('resize',measure);};},[]);
 const [moveMode,setMoveMode]=useState(false),[review,setReview]=useState<MoveProposal|null>(null);
 const reviewDialog=useRef<HTMLDialogElement>(null);
 const drag=useMobileScheduleDrag(jobs,range,!moveMode||busy||Boolean(review),setReview);
 const currentJob=review&&jobs.find(job=>job.recordId===review.job.recordId);
 const reviewMove=currentJob&&review?scheduleMoveProposal(currentJob,review.truck,review.start,jobs):null;
 const blocked=busy?'Another schedule change is being verified.':!currentJob?'Appointment is no longer available.':(currentJob.version!==review?.job.version||currentJob.truck!==review?.job.truck||currentJob.appointmentStartMinutes!==review?.job.appointmentStartMinutes||currentJob.appointmentEndMinutes!==review?.job.appointmentEndMinutes?'Source assignment changed. Cancel and review the current appointment.':null)||scheduleMoveRestriction(currentJob)||(!scheduleMoveWindow(currentJob,review?.start??null).supported?'This booked window cannot be retimed through JunkWare. Keep its current time.':null);
 useEffect(()=>{if(review)reviewDialog.current?.showModal();else reviewDialog.current?.close();},[review]);
 const rows=trucks.map(truck=>{
  const timed=scheduleBoardJobs(jobs,truck,now);
  const untimed=jobs.filter(job=>scheduleDisplayTruck(job)===truckLabel(truck)&&!timelinePlacement(job,range,truck,now));
  const stops=groupNearbyHqStops((snapshot.operationalStops||[]).filter(stop=>truckLabel(stop.truck)===truck),timed,truck,now);
  const {placed}=scheduleTravelLayout(timed,[],range,truck,now,width,true,false);
  const occupied:Array<Array<{left:number;right:number}>>=[];
  const pack=(rawLeft:number,rawWidth:number)=>{
   const span=Math.min(1,Math.max(15/range.duration,rawWidth));
   const left=Math.max(0,Math.min(1-span,rawLeft)),right=left+span;
   let lane=occupied.findIndex(items=>items.every(item=>right<=item.left+1e-9||left>=item.right-1e-9));
   if(lane<0)lane=occupied.length;(occupied[lane]||=[]).push({left,right});return{left,span,lane};
  };
  const visits=placed.flatMap(({job,position})=>position.segments.map((segment,i)=>({job,position,interval:position.intervals[i],i,...pack(segment.left,segment.width)})));
  const gapStops:ScheduleOperationalStop[]=placed.flatMap(({job,position})=>position.gaps.flatMap((gap,i)=>gap.kind==='dump'&&!stops.some(stop=>stop.kind==='dump'&&stop.startMinutes>=gap.start&&stop.startMinutes<=gap.end)?[{id:`${job.recordId}:gap:${i}`,truck,name:gap.facilityName||'Dump',facility:gap.facilityName||'Dump',kind:'dump',label:'Dump',startMinutes:gap.start,endMinutes:gap.end,enteredAt:null,departedAt:null,observedThrough:'',ongoing:false}]:[]));
  const facilities=[...stops,...gapStops].map(stop=>({stop,...pack((stop.startMinutes-range.start)/range.duration,12/width)}));
  const gapRows=Math.ceil(untimed.length/Math.max(1,Math.floor(width/18)));
  return{truck,timed,untimed,visits,facilities,gapRows,lanes:occupied.length,load:snapshot.truckLoads?.find(load=>truckLabel(load.truck)===truck)};
 });
 const heightFor=(row:typeof rows[number],step:number)=>Math.max(step===16?30:24,Math.max(1,row.lanes)*step+4+row.gapRows*18);
 const laneStep=(viewportHeight<=450?[12,10]:[16,12,10]).find(step=>rows.reduce((sum,row)=>sum+heightFor(row,step),0)+84<=viewportHeight-48)||10;
 const short=laneStep<16;
 const detail=rows.find(row=>row.truck===detailTruck);
 const hours=range.duration/60,step=hours>12?120:60;
 const ticks=Array.from({length:Math.ceil(range.duration/step)+1},(_,i)=>Math.min(range.end,range.start+i*step));
 return <div ref={ref} className={`mobile-schedule-overview${short?' short':''}${moveMode?' move-mode':''}`} role="region" style={{'--overview-marker-height':`${laneStep-2}px`} as CSSProperties} data-lane-step={laneStep} aria-label={`Full truck schedule, ${clock(range.start)} to ${clock(range.end)}`} data-range-start={range.start} data-range-end={range.end}>
  <div className="mobile-schedule-guide"><span>{moveMode?'Drag a block; release to review':'Full day · Tap for details'}</span><button type="button" aria-pressed={moveMode} disabled={busy} onClick={()=>{drag.cancel();setMoveMode(value=>!value);}}>{moveMode?'Done':'Move'}</button></div>
  {drag.preview&&<div className="mobile-schedule-drag-status" role="status">{drag.preview.job.jkNumber} → {truckDisplayText(drag.preview.truck)} · {scheduleMoveWindow(drag.preview.job,drag.preview.start).label}</div>}
  <div className="mobile-schedule-axis"><span>Truck</span><div>{ticks.map((m,i)=><time key={m} style={{left:`${(m-range.start)/range.duration*100}%`,transform:i===0?'none':i===ticks.length-1?'translateX(-100%)':'translateX(-50%)'}}>{hour(m)}</time>)}</div></div>
  {rows.map(row=><div key={row.truck} className="mobile-schedule-row" data-overview-truck={row.truck} data-drop-target={drag.preview?.truck===row.truck||undefined} style={{height:heightFor(row,laneStep)}}>
   <button className="mobile-schedule-truck" type="button" popoverTarget={id} onClick={()=>setDetailTruck(row.truck)} aria-label={`${truckDisplayText(row.truck)}, ${row.timed.length+row.untimed.length} appointments, details`}><strong>{row.truck==='Unassigned'?'Unassigned':truckDisplayText(row.truck).replace('Truck#','Truck')}</strong><small>{row.timed.length+row.untimed.length} stops</small></button>
   <div className="mobile-schedule-track" style={{'--overview-hour-size':`${100/hours}%`} as CSSProperties}>
    {row.visits.map(v=>{const tone=v.position.actual&&v.interval.ongoing?'on-site':scheduleStatusTone(v.job);const label=`${v.job.jkNumber} · ${v.job.customerName} · ${clock(v.interval.start)}–${clock(v.interval.end)} · ${v.position.actual?'Recorded visit':'Booked window'} · ${appointmentStatus(v.job)}`;
     return <button key={`${v.job.recordId}:${v.i}`} type="button" className={`mobile-schedule-visit ${appointmentColorClass(v.job)} status-${tone}${v.position.actual?' recorded':' planned'}${selected===v.job.recordId?' selected':''}`} data-schedule-appointment={v.job.recordId} data-time-basis={v.position.actual?'actual':'booked'} data-visit-start={v.interval.start} data-visit-end={v.interval.end} style={{left:`${v.left*100}%`,width:`${v.span*100}%`,top:v.lane*laneStep+2}} title={label} aria-label={label} aria-pressed={selected===v.job.recordId} onKeyDown={event=>{if(!drag.preview&&['Enter',' '].includes(event.key))drag.suppressClick.current=false;}} onPointerDown={event=>drag.begin(event,v.job)} onContextMenu={event=>{if(moveMode)event.preventDefault();}} onClick={()=>{if(!drag.suppressClick.current)select(v.job.recordId);}}><span aria-hidden="true">{v.span*width>=10?mark(tone):''}</span></button>;
    })}
    {row.facilities.map(({stop,left,span,lane})=><button key={stop.id} type="button" className="mobile-schedule-facility" data-operational-stop={stop.kind} style={{left:`${left*100}%`,width:`${span*100}%`,top:lane*laneStep+2}} popoverTarget={id} onClick={()=>setDetailTruck(row.truck)} aria-label={`${stop.label}, ${clock(stop.startMinutes)}`} title={stop.label}><svg viewBox="0 0 24 24" aria-hidden="true">{stop.kind==='hq'||stop.kind==='departure'?<path d="M3 11 12 3l9 8M5 10v11h14V10M10 21v-7h4v7" fill="none" stroke="currentColor" strokeWidth="2"/>:stop.kind==='dump'?<DumpTruckGlyph/>:<path d="M4 3h16v4h-6v10h6v4H4v-4h6V7H4Z" fill="currentColor"/>}</svg></button>)}
    {row.untimed.map((job,i)=><button key={job.recordId} type="button" className={`mobile-schedule-untimed ${appointmentColorClass(job)}`} data-schedule-appointment={job.recordId} style={{left:i%Math.max(1,Math.floor(width/18))*18,top:Math.max(1,row.lanes)*laneStep+2+Math.floor(i/Math.max(1,Math.floor(width/18)))*18}} aria-label={`${job.jkNumber}, ${job.customerName}, time unavailable`} title={`${job.jkNumber} · Time unavailable`} onKeyDown={event=>{if(!drag.preview&&['Enter',' '].includes(event.key))drag.suppressClick.current=false;}} onPointerDown={event=>drag.begin(event,job)} onClick={()=>{if(!drag.suppressClick.current)select(job.recordId);}}>?</button>)}
   </div>
  </div>)}
  <div className="mobile-schedule-legend"><span>✓ Closed</span><span>× Canceled</span><span>● On site</span><span>? Unconfirmed / no time</span></div>
  <dialog ref={reviewDialog} className="mobile-schedule-move-review" aria-label="Review appointment move" onCancel={()=>setReview(null)}>
   <h3>Review appointment move</h3><p>{review?.job.jkNumber} · {review?.job.customerName}</p>
   <p>From {review&&truckDisplayText(review.job.truck)} · {review?.job.appointmentTime||'Time not set'}</p>
   <p>To <strong>{review&&truckDisplayText(review.truck)} · {review&&scheduleMoveWindow(review.job,review.start).label}</strong></p>
   {reviewMove?.conflicts.length?<p role="alert">Overlapping appointments: {reviewMove.conflicts.join(', ')}. Review this overlap before confirming.</p>:null}
   {blocked&&<p role="alert">{blocked}</p>}
   <p>Confirm submits this change to JunkWare for verification.</p>
   <button type="button" onClick={()=>setReview(null)}>Cancel</button><button type="button" disabled={Boolean(blocked)||!reviewMove} onClick={()=>{if(!blocked&&reviewMove){setReview(null);setMoveMode(false);onMove(reviewMove);}}}>Confirm Move</button>
  </dialog>
  <div id={id} popover="auto" className="mobile-schedule-detail" role="dialog" aria-label="Truck schedule details"><header><h3>{detail?truckDisplayText(detail.truck):'Truck'} details</h3><button type="button" popoverTarget={id} popoverTargetAction="hide" aria-label="Close truck schedule details">×</button></header>
   {detail&&<><p>{detail.load?[detail.load.label,detail.load.note].filter(Boolean).join(' · '):'Load not recorded'}</p><p>Color shows territory. Dashed outline: booked window. Solid outline: recorded visit. Short blocks have a 15-minute display minimum; actual times are listed below.</p>
   {[...detail.timed,...detail.untimed].map(job=><button key={job.recordId} type="button" className={`mobile-schedule-detail-job ${appointmentColorClass(job)}`} onClick={event=>{event.currentTarget.closest<HTMLElement>('[popover]')?.hidePopover();select(job.recordId);}}><strong>{job.jkNumber} · {job.customerName}</strong><span>{job.appointmentTime||'Time unavailable'} · {appointmentStatus(job)}</span>{job.truckVisits?.filter(v=>truckLabel(v.truck)===detail.truck).map((visit,i)=><small key={i}>Recorded: {new Date(visit.arrival).toLocaleTimeString('en-US',{timeZone:'America/Chicago',hour:'numeric',minute:'2-digit'})}–{visit.departure?new Date(visit.departure).toLocaleTimeString('en-US',{timeZone:'America/Chicago',hour:'numeric',minute:'2-digit'}):'departure unconfirmed'}</small>)}</button>)}
   {detail.facilities.map(({stop})=><p key={stop.id}>{stop.label} · {clock(stop.startMinutes)}–{clock(stop.endMinutes)}</p>)}
   {legs.filter(leg=>truckLabel(leg.truck)===detail.truck).map(leg=><p key={`${leg.fromAppointmentId}:${leg.toAppointmentId}`}>Estimated travel {leg.travelMinutes===null?'unavailable':`${leg.travelMinutes}m`} · {leg.fromJk} → {leg.toJk}</p>)}
   </>}
  </div>
 </div>;
}
