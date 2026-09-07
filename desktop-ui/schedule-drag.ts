import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import {
  truckLabel,
  scheduleMoveRestriction,
  type ScheduleAppointment,
  type timelineRange,
} from "./lib/schedule-contract";
import type { MoveProposal } from "./lib/schedule-contract";

/** Scroll only near a visible edge, with bounded speed while a drag is held. */
export function scheduleDragScrollStep(y: number, top: number, bottom: number) {
  const edge=Math.min(48,(bottom-top)/4);
  if(edge<=0 || y<top-8 || y>bottom+8) return 0;
  if(y<top+edge) return -Math.ceil(14*Math.min(1,(top+edge-y)/edge));
  if(y>bottom-edge) return Math.ceil(14*Math.min(1,(y-bottom+edge)/edge));
  return 0;
}

export function scheduleMoveProposal(
  job: ScheduleAppointment,
  truck: string,
  start: number | null,
  jobs: ScheduleAppointment[],
): MoveProposal {
  const duration =
    job.appointmentStartMinutes !== null && job.appointmentEndMinutes !== null
      ? job.appointmentEndMinutes - job.appointmentStartMinutes
      : null;
  const nextStart = start ?? job.appointmentStartMinutes;
  const nextEnd = nextStart !== null && duration !== null ? nextStart + duration : null;
  const conflicts = jobs
    .filter(
      (other) =>
        other.recordId !== job.recordId &&
        truck !== "Unassigned" &&
        truckLabel(other.truck) === truck &&
        !/cancel/i.test(other.status) &&
        nextStart !== null &&
        nextEnd !== null &&
        other.appointmentStartMinutes !== null &&
        other.appointmentEndMinutes !== null &&
        other.appointmentStartMinutes < nextEnd &&
        other.appointmentEndMinutes > nextStart,
    )
    .map((other) => other.jkNumber);
  return { job, truck, start, conflicts };
}
export function useScheduleDrag(
  jobs: ScheduleAppointment[],
  range: ReturnType<typeof timelineRange>,
  onDrop: (move: MoveProposal) => void,
  date: string,
  disabled = false,
  onBlocked?: (reason: string) => void,
) {
  const [preview, setPreview] = useState<MoveProposal | null>(null);
  const suppressClick = useRef(false);
  const cleanup = useRef<(() => void) | null>(null);
  useEffect(() => () => cleanup.current?.(), [date]);
  const begin = (event: ReactPointerEvent<HTMLElement>, job: ScheduleAppointment) => {
    if (event.button !== 0) return;
    suppressClick.current = false;
    const target = event.target as HTMLElement;
    if (
      disabled ||
      (target.closest("button,a,input,select") && !target.closest('.schedule-jk-link'))
    )
      return;
    cleanup.current?.();
    // Cancel native text selection before the browser begins its drag gesture.
    event.preventDefault();
    document.body.classList.add('schedule-pointer-drag');
    const x = event.clientX,
      y = event.clientY;
    const element = event.currentTarget;
    const pointerId = event.pointerId;
    element.setPointerCapture(pointerId);
    const block = element.getBoundingClientRect();
    const grabOffset = x - block.left;
    let moved = false;
    const restriction = scheduleMoveRestriction(job);
    let proposal: MoveProposal | null = null;
    let frame: number | null = null;
    let lastPointer = {clientX:x,clientY:y};
    const scrollParents: HTMLElement[] = [];
    for(let parent=element.parentElement;parent;parent=parent.parentElement) {
      if(/auto|scroll/.test(getComputedStyle(parent).overflowY) && parent.scrollHeight>parent.clientHeight) scrollParents.push(parent);
    }
    const page=document.scrollingElement as HTMLElement | null;
    if(page && !scrollParents.includes(page)) scrollParents.push(page);
    const finish = () => {
      if(frame!==null) window.cancelAnimationFrame(frame);
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", cancel);
      window.removeEventListener("keydown", keydown, true);
      window.removeEventListener("blur", cancel);
      element.removeEventListener("lostpointercapture", cancel);
      if (element.hasPointerCapture(pointerId)) element.releasePointerCapture(pointerId);
      document.body.classList.remove('schedule-pointer-drag');
      setPreview(null);
      cleanup.current = null;
    };
    const updateProposal = (pointer: {clientX:number;clientY:number}) => {
      const row = document
        .elementFromPoint(pointer.clientX, pointer.clientY)
        ?.closest<HTMLElement>("[data-schedule-truck]");
      const timeline = row?.querySelector<HTMLElement>(".live-truck-timeline");
      if (!row || !timeline) {
        proposal = null;
        setPreview(null);
        return;
      }
      const rect = timeline.getBoundingClientRect();
      const truck = row.dataset.scheduleTruck!;
      const duration =
        job.appointmentStartMinutes !== null && job.appointmentEndMinutes !== null
          ? job.appointmentEndMinutes - job.appointmentStartMinutes
          : 60;
      const rawStart =
        range.start + ((pointer.clientX - rect.left - grabOffset) / rect.width) * range.duration;
      const snapped = Math.max(
        range.start,
        Math.min(range.end - duration, Math.round(rawStart / 60) * 60),
      );
      // A primarily vertical move retains the exact original window, including
      // half-hour windows the source UI cannot currently retime.
      const start = Math.abs(pointer.clientX - x) < 20 ? job.appointmentStartMinutes : snapped;
      proposal = scheduleMoveProposal(job, truck, start, jobs);
      setPreview(proposal);
    };
    const scroll = () => {
      for(const parent of scrollParents) {
        const rect=parent.getBoundingClientRect();
        const top=parent===page?0:Math.max(0,rect.top);
        const bottom=parent===page?window.innerHeight:Math.min(window.innerHeight,rect.bottom);
        if(parent!==page && (lastPointer.clientX<rect.left || lastPointer.clientX>rect.right)) continue;
        const step=scheduleDragScrollStep(lastPointer.clientY,top,bottom);
        const before=parent.scrollTop;
        if(step) parent.scrollTop+=step;
        if(parent.scrollTop!==before) {updateProposal(lastPointer);break;}
      }
      frame=window.requestAnimationFrame(scroll);
    };
    const move = (pointer: PointerEvent) => {
      if (pointer.pointerId !== pointerId) return;
      if (!moved && Math.hypot(pointer.clientX - x, pointer.clientY - y) < 6) return;
      if (!moved) element.focus({ preventScroll: true });
      if (!moved && restriction) onBlocked?.(restriction);
      moved = true;
      suppressClick.current = true;
      pointer.preventDefault();
      if (restriction) return;
      lastPointer={clientX:pointer.clientX,clientY:pointer.clientY};
      updateProposal(lastPointer);
      if(frame===null) frame=window.requestAnimationFrame(scroll);
    };
    const up = (pointer: PointerEvent) => {
      if (pointer.pointerId !== pointerId) return;
      const result = proposal;
      finish();
      if (
        moved &&
        result &&
        (result.truck !== truckLabel(job.truck) || result.start !== job.appointmentStartMinutes)
      )
        onDrop(result);
    };
    const cancel = () => finish();
    const keydown = (key: KeyboardEvent) => {
      if (key.key === "Escape") {
        key.preventDefault();
        key.stopPropagation();
        finish();
      }
    };
    cleanup.current = finish;
    window.addEventListener("pointermove", move, { passive: false });
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", cancel);
    window.addEventListener("keydown", keydown, true);
    window.addEventListener("blur", cancel);
    element.addEventListener("lostpointercapture", cancel);
  };
  return { preview, begin, suppressClick };
}
