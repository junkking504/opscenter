/** Single-finger shortcuts supplement visible controls; navigation never wraps. */
export const GESTURE = { edge: 28, distance: 96, ratio: 1.8, drift: 12, holdMs: 550, maxMs: 900, cooldownMs: 650 } as const;
export type GesturePoint = { x: number; y: number; at: number };
export function horizontalIntent(start: GesturePoint, end: GesturePoint, viewportWidth: number): -1 | 0 | 1 {
  const dx=end.x-start.x, dy=end.y-start.y;
  if (start.x<GESTURE.edge || start.x>viewportWidth-GESTURE.edge || end.at-start.at>GESTURE.maxMs || end.at<start.at) return 0;
  if (Math.abs(dx)<GESTURE.distance || Math.abs(dx)<Math.abs(dy)*GESTURE.ratio) return 0;
  return dx<0 ? 1 : -1;
}
export function downwardIntent(start: GesturePoint, end: GesturePoint): boolean {
  const dy=end.y-start.y;
  return end.at>=start.at && end.at-start.at<=GESTURE.maxMs && dy>=GESTURE.distance && dy>=Math.abs(end.x-start.x)*GESTURE.ratio;
}
export function adjacentWorkspace(current: string, order: readonly string[], direction: -1 | 0 | 1): string | undefined {
  const index=order.indexOf(current);
  return direction && index>=0 ? order[index+direction] : undefined;
}
