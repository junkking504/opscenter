import {useEffect,useRef,useState,type PointerEvent as ReactPointerEvent} from 'react';
import {scheduleMoveProposal} from './schedule-drag';
import {scheduleMoveRestriction,truckLabel,type MoveProposal,type ScheduleAppointment} from './lib/schedule-contract';

/** Explicit move mode owns gestures only on appointment markers. Everywhere
 * else still scrolls normally. A deliberate valid drop submits through the established move pathway. */
export function useMobileScheduleDrag(jobs:ScheduleAppointment[],range:{start:number;end:number;duration:number},disabled:boolean,onDrop:(proposal:MoveProposal)=>void,onBlocked:(reason:string)=>void) {
 const [preview,setPreview]=useState<MoveProposal|null>(null);
 const currentDrop=useRef(onDrop);currentDrop.current=onDrop;
 const cleanup=useRef<(()=>void)|null>(null),suppressClick=useRef(false);
 useEffect(()=>()=>cleanup.current?.(),[]);
 useEffect(()=>{if(disabled)cleanup.current?.();},[disabled]);
 const begin=(event:ReactPointerEvent<HTMLElement>,job:ScheduleAppointment)=>{
  suppressClick.current=false;
  if(disabled||event.button!==0||!event.isPrimary)return;
  const restriction=scheduleMoveRestriction(job);if(restriction){suppressClick.current=true;event.preventDefault();onBlocked(restriction);return;}
  cleanup.current?.();
  const element=event.currentTarget,pointerId=event.pointerId,x=event.clientX,y=event.clientY;
  let moved=false,proposal:MoveProposal|null=null;
  const originRow=element.closest<HTMLElement>('[data-overview-truck]');
  const originTruck=originRow?.dataset.overviewTruck;
  const originTrack=originRow?.querySelector('.mobile-schedule-track');
  const origin=originTrack?.getBoundingClientRect();if(!origin)return;
  // touch-action:none is set before an armed gesture. Keep a stationary tap
  // native so WebKit still opens details; suppress clicks only after movement.
  element.setPointerCapture(pointerId);
  const finish=()=>{
   window.removeEventListener('pointermove',move);window.removeEventListener('pointerup',up);window.removeEventListener('pointercancel',cancel);window.removeEventListener('blur',cancel);window.removeEventListener('resize',cancel);window.removeEventListener('keydown',keydown,true);element.removeEventListener('lostpointercapture',cancel);
   if(element.hasPointerCapture(pointerId))element.releasePointerCapture(pointerId);
   document.body.classList.remove('schedule-pointer-drag');setPreview(null);cleanup.current=null;
  };
  const move=(p:PointerEvent)=>{
   if(p.pointerId!==pointerId)return;
   if(!moved&&Math.hypot(p.clientX-x,p.clientY-y)<6)return;
   moved=true;suppressClick.current=true;p.preventDefault();document.body.classList.add('schedule-pointer-drag');
   const row=document.elementFromPoint(p.clientX,p.clientY)?.closest<HTMLElement>('[data-overview-truck]');
   const track=row?.querySelector('.mobile-schedule-track')?.getBoundingClientRect();
   if(!row||!track||p.clientX<track.left||p.clientX>track.right){proposal=null;setPreview(null);return;}
   const duration=job.appointmentStartMinutes!==null&&job.appointmentEndMinutes!==null?job.appointmentEndMinutes-job.appointmentStartMinutes:60;
   // Relative movement retains the source window despite minimum-width markers
   // or recorded-visit positioning. Vertical assignment changes keep exact time.
   const delta=p.clientX-x;
   const raw=(job.appointmentStartMinutes??range.start)+delta/origin.width*range.duration;
   const start=Math.abs(delta)<12?job.appointmentStartMinutes:Math.max(range.start,Math.min(range.end-duration,Math.round(raw/60)*60));
   proposal=scheduleMoveProposal(job,row.dataset.overviewTruck!,start,jobs);setPreview(proposal);
  };
  const up=(p:PointerEvent)=>{if(p.pointerId!==pointerId)return;if(moved)move(p);const result=proposal;finish();if(moved&&result&&(result.truck!==originTruck||result.start!==job.appointmentStartMinutes)&&(result.truck!==truckLabel(job.truck)||result.start!==job.appointmentStartMinutes))currentDrop.current(result);};
  const cancel=()=>{suppressClick.current=true;finish();};
  const keydown=(e:KeyboardEvent)=>{if(e.key==='Escape'){e.preventDefault();e.stopPropagation();cancel();}};
  cleanup.current=cancel;
  window.addEventListener('pointermove',move,{passive:false});window.addEventListener('pointerup',up);window.addEventListener('pointercancel',cancel);window.addEventListener('blur',cancel);window.addEventListener('resize',cancel);window.addEventListener('keydown',keydown,true);element.addEventListener('lostpointercapture',cancel);
 };
 return{begin,preview,suppressClick,cancel:()=>cleanup.current?.()};
}
