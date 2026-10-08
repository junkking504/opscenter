import { useCallback, useLayoutEffect, useRef, useState, type CSSProperties, type RefObject } from 'react';
import { ArrowLeftRight, GripVertical, RotateCcw } from 'lucide-react';
import './schedule-split.css';

// A null share leaves the existing responsive layout completely in charge.
export function useScheduleSplit(boardRef: RefObject<HTMLDivElement | null>, mapRef: RefObject<HTMLElement | null>, enabled: boolean) {
  const [share, setShare] = useState<number | null>(null);
  const [geometry, setGeometry] = useState({ left: 0, share: 32.5, minimum: 25 });
  const drag = useRef<{ pointer: number; start: number | null; offset: number } | null>(null);
  const dividerRef = useRef<HTMLDivElement>(null);
  const measure = useCallback(() => {
    const board = boardRef.current;
    const map = mapRef.current;
    if (!board || !map) return null;
    const bounds = board.getBoundingClientRect();
    const mapBounds = map.getBoundingClientRect();
    const gap = parseFloat(getComputedStyle(board).columnGap) || 0;
    const width = bounds.width - gap;
    if (width <= 0) return null;
    return { bounds, width, gap, left: mapBounds.right - bounds.left + gap / 2,
      share: mapBounds.width / width * 100, minimum: Math.min(40, Math.max(25, 280 / width * 100)) };
  }, [boardRef, mapRef]);
  const change = (value: number) => {
    const current = measure();
    if (current) setShare(Math.max(current.minimum, Math.min(100 - current.minimum, value)));
  };
  useLayoutEffect(() => {
    if (!enabled || !boardRef.current || !mapRef.current) return;
    const update = () => {
      const current = measure();
      if (!current || window.innerWidth <= 900) return;
      setGeometry({ left: current.left, share: current.share, minimum: current.minimum });
      setShare(value => value === null ? null : Math.max(current.minimum, Math.min(100 - current.minimum, value)));
    };
    const observer = new ResizeObserver(update);
    observer.observe(boardRef.current);
    observer.observe(mapRef.current);
    update();
    return () => { observer.disconnect(); drag.current = null; };
  }, [enabled, boardRef, mapRef, measure]);

  const style = share === null ? undefined : { '--schedule-map-share': `${share}fr`, '--schedule-truck-share': `${100 - share}fr` } as CSSProperties;
  const controls = enabled && <div className="schedule-split-actions" role="group" aria-label="Map and truck schedule layout">
    <button type="button" onClick={() => { const current = measure(); if (current) change(100 - current.share); }} title="Exchange the widths of the map and truck schedule"><ArrowLeftRight size={13} />Swap sizes</button>
    <button type="button" onClick={() => setShare(null)} disabled={share === null} title="Restore the original map and schedule widths"><RotateCcw size={13} />Reset layout</button>
  </div>;
  const divider = enabled && <div ref={dividerRef} className="schedule-split-divider" role="separator" tabIndex={0}
    aria-label="Resize map and truck schedule" aria-orientation="vertical"
    aria-valuemin={Math.floor(geometry.minimum)} aria-valuemax={Math.ceil(100 - geometry.minimum)} aria-valuenow={Math.round(geometry.share)}
    aria-valuetext={`Map ${Math.round(geometry.share)} percent, truck schedule ${Math.round(100 - geometry.share)} percent`}
    title="Drag to resize · Arrow keys to adjust · Double-click to reset" style={{ left: geometry.left }}
    onDoubleClick={() => setShare(null)}
    onPointerDown={event => {
      if (event.button !== 0 || window.innerWidth <= 900) return;
      const current = measure();
      if (!current) return;
      event.preventDefault();
      event.currentTarget.focus();
      event.currentTarget.setPointerCapture(event.pointerId);
      drag.current = { pointer: event.pointerId, start: share, offset: event.clientX - current.bounds.left - current.left };
    }}
    onPointerMove={event => {
      const active = drag.current;
      const current = measure();
      if (!active || active.pointer !== event.pointerId || !current) return;
      change((event.clientX - current.bounds.left - active.offset - current.gap / 2) / current.width * 100);
    }}
    onPointerUp={event => { drag.current = null; if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId); }}
    onPointerCancel={() => { if (drag.current) setShare(drag.current.start); drag.current = null; }}
    onLostPointerCapture={() => { drag.current = null; }}
    onKeyDown={event => {
      if (event.key === 'Escape' && drag.current) {
        event.preventDefault(); setShare(drag.current.start); drag.current = null;
      } else if (event.key === 'Home') {
        event.preventDefault(); setShare(null);
      } else if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
        event.preventDefault();
        const current = measure();
        if (current) change(current.share + (event.key === 'ArrowLeft' ? -1 : 1) * (event.shiftKey ? 10 : 2));
      }
    }}><GripVertical size={14} aria-hidden="true" /></div>;
  return { style, controls, divider, customized: share !== null };
}
