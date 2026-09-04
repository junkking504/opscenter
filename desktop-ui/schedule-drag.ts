import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import {
  assignmentNeedsVerification,
  isClosed,
  truckLabel,
  type ScheduleAppointment,
  type timelineRange,
} from "./lib/schedule-contract";
import type { MoveProposal } from "./lib/schedule-contract";

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
) {
  const [preview, setPreview] = useState<MoveProposal | null>(null);
  const suppressClick = useRef(false);
  const cleanup = useRef<(() => void) | null>(null);
  useEffect(() => () => cleanup.current?.(), [date]);
  const begin = (event: ReactPointerEvent<HTMLElement>, job: ScheduleAppointment) => {
    if (
      disabled ||
      event.button !== 0 ||
      isClosed(job) ||
      assignmentNeedsVerification(job) ||
      (event.target as HTMLElement).closest("button,a,input,select")
    )
      return;
    cleanup.current?.();
    suppressClick.current = false;
    const x = event.clientX,
      y = event.clientY;
    const element = event.currentTarget;
    const block = element.getBoundingClientRect();
    const grabOffset = x - block.left;
    let moved = false;
    let proposal: MoveProposal | null = null;
    const finish = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", cancel);
      window.removeEventListener("keydown", keydown, true);
      setPreview(null);
      cleanup.current = null;
    };
    const move = (pointer: PointerEvent) => {
      if (!moved && Math.hypot(pointer.clientX - x, pointer.clientY - y) < 6) return;
      if (!moved) element.focus({ preventScroll: true });
      moved = true;
      suppressClick.current = true;
      pointer.preventDefault();
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
    const up = () => {
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
  };
  return { preview, begin, suppressClick };
}
