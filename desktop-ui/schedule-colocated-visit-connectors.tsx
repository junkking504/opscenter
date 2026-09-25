import { useLayoutEffect, useRef, useState } from 'react';
import { truckGpsStatus } from '../lib/truck-gps-status';
import { truckLabel, type ScheduleAppointment, type ScheduleTruck } from './lib/schedule-contract';

type Link = { key:string; appointment:string; fromTruck:string; toTruck:string; x1:number; x2:number; bendX:number; y1:number; y2:number };
const COLOCATED_RADIUS_METERS=200;
const radians=(degrees:number)=>degrees*Math.PI/180;
const distanceMeters=(a:{latitude:number;longitude:number},b:{latitude:number;longitude:number})=>{
  const earth=6371000,dLat=radians(b.latitude-a.latitude),dLon=radians(b.longitude-a.longitude);
  const value=Math.sin(dLat/2)**2+Math.cos(radians(a.latitude))*Math.cos(radians(b.latitude))*Math.sin(dLon/2)**2;
  return 2*earth*Math.atan2(Math.sqrt(value),Math.sqrt(1-value));
};

export default function ScheduleColocatedVisitConnectors({refreshKey,appointments,trucks,now}:{refreshKey:string;appointments:ScheduleAppointment[];trucks:ScheduleTruck[];now:number}) {
  const overlayRef=useRef<SVGSVGElement>(null);
  const [links,setLinks]=useState<Link[]>([]);

  useLayoutEffect(()=>{
    const overlay=overlayRef.current;
    const board=overlay?.parentElement;
    if (!overlay || !board) return;
    let frame=0;
    const measure=()=>{
      window.cancelAnimationFrame(frame);
      frame=window.requestAnimationFrame(()=>{
        const boardRect=board.getBoundingClientRect();
        const blocks=[...board.querySelectorAll<HTMLElement>('[data-time-basis="actual"][data-schedule-appointment][data-visit-truck]')];
        const grouped=new Map<string,HTMLElement[]>();
        for (const block of blocks) {
          const id=block.dataset.scheduleAppointment!;
          grouped.set(id,[...(grouped.get(id)||[]),block]);
        }
        const next:Link[]=[];
        for (const [appointment,visits] of grouped) {
          for (let a=0;a<visits.length;a+=1) for (let b=a+1;b<visits.length;b+=1) {
            const first=visits[a],second=visits[b];
            const fromTruck=first.dataset.visitTruck!,toTruck=second.dataset.visitTruck!;
            if (fromTruck===toTruck) continue;
            const start=Math.max(Number(first.dataset.visitStart),Number(second.dataset.visitStart));
            const end=Math.min(Number(first.dataset.visitEnd),Number(second.dataset.visitEnd));
            const overlap=Number.isFinite(start) && Number.isFinite(end) && end>start;
            const job=appointments.find(candidate=>candidate.recordId===appointment);
            const firstTruck=trucks.find(candidate=>truckLabel(candidate.truck)===truckLabel(fromTruck));
            const secondTruck=trucks.find(candidate=>truckLabel(candidate.truck)===truckLabel(toTruck));
            const currentCoLocation=Boolean(!overlap && first.dataset.visitComplete==='false' && second.dataset.visitComplete==='false' && job?.location &&
              firstTruck?.latitude!=null && firstTruck.longitude!=null && secondTruck?.latitude!=null && secondTruck.longitude!=null &&
              !truckGpsStatus(firstTruck,now).stale && !truckGpsStatus(secondTruck,now).stale &&
              distanceMeters(firstTruck as {latitude:number;longitude:number},job.location)<=COLOCATED_RADIUS_METERS &&
              distanceMeters(secondTruck as {latitude:number;longitude:number},job.location)<=COLOCATED_RADIUS_METERS);
            if (!overlap && !currentCoLocation) continue;
            const firstRect=first.getBoundingClientRect(),secondRect=second.getBoundingClientRect();
            const firstTimeline=first.closest<HTMLElement>('.live-truck-timeline')?.getBoundingClientRect();
            const secondTimeline=second.closest<HTMLElement>('.live-truck-timeline')?.getBoundingClientRect();
            const firstLeft=Number(first.dataset.visitLeft),firstRight=Number(first.dataset.visitRight);
            const secondLeft=Number(second.dataset.visitLeft),secondRight=Number(second.dataset.visitRight);
            if (!firstTimeline || !secondTimeline || ![firstLeft,firstRight,secondLeft,secondRight].every(Number.isFinite)) continue;
            const firstBefore=Number(first.dataset.visitEnd)<=Number(second.dataset.visitStart);
            const sharedMinute=(start+end)/2;
            const firstStart=Number(first.dataset.visitStart),firstEnd=Number(first.dataset.visitEnd);
            const firstShared=firstLeft+(sharedMinute-firstStart)/(firstEnd-firstStart)*(firstRight-firstLeft);
            const x1=firstTimeline.left-boardRect.left+firstTimeline.width*(overlap?firstShared:firstBefore?firstRight:firstLeft);
            const x2=secondTimeline.left-boardRect.left+secondTimeline.width*(overlap?firstShared:firstBefore?secondLeft:secondRight);
            const bendX=(x1+x2)/2;
            const y1=firstRect.top+firstRect.height/2-boardRect.top,y2=secondRect.top+secondRect.height/2-boardRect.top;
            next.push({key:`${appointment}:${fromTruck}:${toTruck}:${start}:${end}`,appointment,fromTruck,toTruck,x1,x2,bendX,y1,y2});
          }
        }
        setLinks(next);
      });
    };
    const observer=new ResizeObserver(measure);
    observer.observe(board);
    board.querySelectorAll('[data-schedule-truck], [data-time-basis="actual"]').forEach(element=>observer.observe(element));
    window.addEventListener('resize',measure);
    measure();
    return()=>{window.cancelAnimationFrame(frame);observer.disconnect();window.removeEventListener('resize',measure);};
  },[refreshKey]);

  return <svg ref={overlayRef} className="schedule-colocated-visit-connectors" role="img" aria-label="Connections between trucks visiting the same appointment location">
    {links.map(link=><g key={link.key} data-co-located-connector={link.appointment} data-from-truck={link.fromTruck} data-to-truck={link.toTruck}>
      <title>{`${link.fromTruck} and ${link.toTruck} were at the same appointment location`}</title>
      <polyline className="schedule-colocated-connector-halo" points={`${link.x1},${link.y1} ${link.bendX},${link.y1} ${link.bendX},${link.y2} ${link.x2},${link.y2}`}/>
      <polyline className="schedule-colocated-connector-line" points={`${link.x1},${link.y1} ${link.bendX},${link.y1} ${link.bendX},${link.y2} ${link.x2},${link.y2}`}/>
      <circle className="schedule-colocated-connector-dot" cx={link.x1} cy={link.y1} r="3"/>
      <circle className="schedule-colocated-connector-dot" cx={link.x2} cy={link.y2} r="3"/>
    </g>)}
  </svg>;
}
