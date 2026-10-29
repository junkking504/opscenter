import { useLayoutEffect, useRef, type RefObject } from 'react';

export type WorkspaceMotionRoute = { workspace: string; page: string };
type Group = { workspace: string; pages: readonly (readonly string[])[] };

/** Navigation order, not text direction: reverse navigation enters from the left. */
export function workspaceMotionDirection(previous: WorkspaceMotionRoute, next: WorkspaceMotionRoute, groups: readonly Group[]): -1 | 1 {
  const order = previous.workspace === next.workspace
    ? groups.find(group => group.workspace === next.workspace)?.pages.map(page => page[0]) || []
    : groups.map(group => group.workspace);
  const from = order.indexOf(previous.workspace === next.workspace ? previous.page : previous.workspace);
  const to = order.indexOf(previous.workspace === next.workspace ? next.page : next.workspace);
  return from >= 0 && to >= 0 && to < from ? -1 : 1;
}

/** The shell clips only horizontal paint while moving, never page scrolling.
 * Starting an interaction settles the content before it can move a hit target. */
export function playWorkspaceMotion(element: HTMLElement, direction: -1 | 1, preference: MediaQueryList) {
  if (preference.matches || typeof element.animate !== 'function') return;
  const frame = element.parentElement;
  const overflow = frame?.style.overflowX || '';
  if (frame) frame.style.overflowX = 'clip';
  const animation = element.animate([
    { transform: `translateX(${direction * 18}px)`, opacity: 0.94 },
    { transform: 'translateX(0)', opacity: 1 },
  ], { duration: 240, easing: 'cubic-bezier(0.22, 1, 0.36, 1)' });
  let settled = false;
  const settle = () => {
    if (settled) return;
    settled = true;
    animation.cancel();
    if (frame) frame.style.overflowX = overflow;
    element.removeEventListener('pointerdown', settle, true);
    preference.removeEventListener('change', reduce);
  };
  const reduce = () => { if (preference.matches) settle(); };
  element.addEventListener('pointerdown', settle, { capture: true, once: true });
  preference.addEventListener('change', reduce);
  void animation.finished.then(settle, settle);
  return settle;
}

/** Animate the committed content in place: no remount, screenshot clone, timeout,
 * delayed navigation, or frame with hidden content. Header/search stay stationary. */
export function useWorkspaceMotion(ref: RefObject<HTMLElement | null>, workspace: string, page: string, groups: readonly Group[]) {
  const previous = useRef({ workspace, page });
  useLayoutEffect(() => {
    const next = { workspace, page };
    const before = previous.current;
    previous.current = next;
    if (before.workspace === workspace && before.page === page) return;
    const element = ref.current;
    const preference = window.matchMedia('(prefers-reduced-motion: reduce)');
    if (!element) return;
    // A record-opening navigation must not temporarily make a fixed drawer
    // relative to the transformed workspace instead of the viewport.
    if ([...element.querySelectorAll('dialog[open],[role="dialog"],[aria-modal="true"]')].some(node => node.getClientRects().length > 0)) return;
    const direction = workspaceMotionDirection(before, next, groups);
    return playWorkspaceMotion(element, direction, preference);
  }, [ref, workspace, page, groups]);
}
