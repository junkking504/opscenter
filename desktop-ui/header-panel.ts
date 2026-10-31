import { useLayoutEffect, type RefObject } from 'react';

const panelEvent = 'ops-header-panel';
/** Coordinate independently mounted search, alert and account disclosures. */
export function useHeaderPanel(id: string, open: boolean, close: () => void, root?: RefObject<HTMLElement | null>) {
  useLayoutEffect(() => {
    if (open) window.dispatchEvent(new CustomEvent(panelEvent, { detail: id }));
  }, [id, open]);
  useLayoutEffect(() => {
    if (!open) return;
    const other = (event: Event) => { if ((event as CustomEvent<string>).detail !== id) close(); };
    const outside = (event: PointerEvent) => { if (root?.current && !root.current.contains(event.target as Node)) close(); };
    const escape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      const trigger = root?.current?.querySelector<HTMLElement>('[aria-expanded="true"]');
      close(); trigger?.focus();
    };
    window.addEventListener(panelEvent, other);
    document.addEventListener('pointerdown', outside);
    window.addEventListener('keydown', escape, true);
    return () => {
      window.removeEventListener(panelEvent, other);
      document.removeEventListener('pointerdown', outside);
      window.removeEventListener('keydown', escape, true);
    };
  }, [id, open, close, root]);
}
