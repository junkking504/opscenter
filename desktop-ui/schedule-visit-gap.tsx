import { truckDisplayText } from '../lib/junkware-trucks';
import { timelinePlacement, type ScheduleAppointment } from './lib/schedule-contract';

const clock = (minute:number) => new Date(Date.UTC(2000,0,1,0,Math.floor(minute))).toLocaleTimeString('en-US',{timeZone:'UTC',hour:'numeric',minute:'2-digit'});

export default function ScheduleVisitGap({job,truck,position,gapIndex,top}: {
  job:ScheduleAppointment;
  truck:string;
  position:NonNullable<ReturnType<typeof timelinePlacement>>;
  gapIndex:number;
  top:number;
}) {
  const gap=position.gaps[gapIndex], segment=position.gapSegments[gapIndex];
  const isDump=gap.kind==='dump';
  const visibleLabel=isDump?'Dump':'Off site';
  const evidence=isDump
    ? `Confirmed dump stop${gap.facilityName?` at ${gap.facilityName}`:''}`
    : 'Truck left this job and later returned; no dump stop was confirmed';
  const label=`${truckDisplayText(truck)} left ${job.jkNumber} at ${clock(gap.start)} and returned at ${clock(gap.end)}. ${evidence}.`;
  return <div
    className={`schedule-visit-gap is-${gap.kind}`}
    style={{left:`${segment.left*100}%`,width:`${segment.width*100}%`,top,height:22}}
    role="note"
    aria-label={label}
    title={label}
    data-visit-gap={gap.kind}
    data-gap-appointment={job.recordId}
  ><span>{visibleLabel}</span></div>;
}
