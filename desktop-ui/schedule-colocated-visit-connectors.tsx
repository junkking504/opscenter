import { useLayoutEffect, useRef, useState } from 'react';

type Link = { key:string; appointment:string; fromTruck:string; toTruck:string; x:number; y1:number; y2:number };

export default function ScheduleColocatedVisitConnectors({refreshKey}:{refreshKey:string}) {
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
            if (!Number.isFinite(start) || !Number.isFinite(end) || end<=start) continue;
            const firstRect=first.getBoundingClientRect(),secondRect=second.getBoundingClientRect();
            const overlapLeft=Math.max(firstRect.left,secondRect.left),overlapRight=Math.min(firstRect.right,secondRect.right);
            const x=(overlapRight>overlapLeft?(overlapLeft+overlapRight)/2:(firstRect.left+secondRect.left+firstRect.width+secondRect.width)/4)-boardRect.left;
            const y1=firstRect.top+firstRect.height/2-boardRect.top,y2=secondRect.top+secondRect.height/2-boardRect.top;
            next.push({key:`${appointment}:${fromTruck}:${toTruck}:${start}:${end}`,appointment,fromTruck,toTruck,x,y1,y2});
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

  return <svg ref={overlayRef} className="schedule-colocated-visit-connectors" aria-label="Connections between trucks visiting the same appointment">
    {links.map(link=><g key={link.key} data-co-located-connector={link.appointment} data-from-truck={link.fromTruck} data-to-truck={link.toTruck}>
      <title>{`${link.fromTruck} and ${link.toTruck} were at the same appointment at the same time`}</title>
      <line className="schedule-colocated-connector-halo" x1={link.x} x2={link.x} y1={link.y1} y2={link.y2}/>
      <line className="schedule-colocated-connector-line" x1={link.x} x2={link.x} y1={link.y1} y2={link.y2}/>
      <circle className="schedule-colocated-connector-dot" cx={link.x} cy={link.y1} r="3"/>
      <circle className="schedule-colocated-connector-dot" cx={link.x} cy={link.y2} r="3"/>
    </g>)}
  </svg>;
}
