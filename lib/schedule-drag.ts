const SCHEDULE_DRAG_SCROLL_EDGE_PX = 72;
const SCHEDULE_DRAG_SCROLL_MAX_PX = 18;

export function scheduleDragScrollDelta(pointer: number, start: number, end: number): number {
  if (end <= start) return 0;
  if (pointer < start + SCHEDULE_DRAG_SCROLL_EDGE_PX) {
    const intensity = Math.min(1, Math.max(0, (start + SCHEDULE_DRAG_SCROLL_EDGE_PX - pointer) / SCHEDULE_DRAG_SCROLL_EDGE_PX));
    return -Math.max(1, Math.round(SCHEDULE_DRAG_SCROLL_MAX_PX * intensity));
  }
  if (pointer > end - SCHEDULE_DRAG_SCROLL_EDGE_PX) {
    const intensity = Math.min(1, Math.max(0, (pointer - (end - SCHEDULE_DRAG_SCROLL_EDGE_PX)) / SCHEDULE_DRAG_SCROLL_EDGE_PX));
    return Math.max(1, Math.round(SCHEDULE_DRAG_SCROLL_MAX_PX * intensity));
  }
  return 0;
}
