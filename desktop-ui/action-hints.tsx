'use client';
import { useEffect, useId, useState } from 'react';
import { createPortal } from 'react-dom';
import './action-hints.css';

/** One delegated hint layer also covers lazily loaded workspaces without wrapping controls. */
export function ActionHints() {
  const id = useId();
  const [hint, setHint] = useState<{ text: string; left: number; top: number } | null>(null);
  useEffect(() => {
    let target: HTMLElement | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let describedBy: string | null = null;
    const hide = () => {
      clearTimeout(timer);
      if (target?.getAttribute('aria-describedby') === id) {
        if (describedBy === null) target.removeAttribute('aria-describedby');
        else target.setAttribute('aria-describedby', describedBy);
      }
      target = null;
      setHint(null);
    };
    const show = (element: EventTarget | null, immediate = false) => {
      if (!(element instanceof Element)) return;
      const control = element.closest<HTMLElement>('button, a[href], summary, select, [role="button"], [role="tab"], input[type="checkbox"], input[type="radio"], [data-action-hint]');
      if (!control || !control.closest('.ops-live') || control.matches(':disabled,[aria-disabled="true"]') || control.closest('[data-no-action-hint]')) { hide(); return; }
      if (control === target) return;
      hide();
      // Preserve intentionally authored native descriptions and existing tooltip ownership.
      if (control.title || control.getAttribute('aria-describedby')) return;
      const label = (control.getAttribute('aria-label') || control.innerText || '').replace(/\s+/g, ' ').trim();
      let text = control.dataset.actionHint;
      if (!text) {
        if (control.tagName === 'SUMMARY') text = control.parentElement?.hasAttribute('open') ? 'Hide details' : 'See data & details';
        else if (control.tagName === 'SELECT') text = 'Choose a view or filter';
        else if (control.getAttribute('role') === 'tab') text = label ? `Open ${label}` : 'Open view';
        else if (control.matches('input')) text = 'Change selection';
        else text = label && label.length <= 85 ? /^(open|view|see|show|hide|close|save|cancel|add|edit|delete|remove|refresh|back|next|previous|select|apply|clear|search|send|submit|copy|download|sign|log|reorder|move|run|retry|load|dismiss|acknowledge|resolve|confirm|create|update|print|upload|review|switch|expand|collapse|reset|enable|disable|choose)\b/i.test(label) ? label : `Open / select ${label}` : 'See details';
      }
      target = control;
      describedBy = control.getAttribute('aria-describedby');
      const reveal = () => {
        if (!control.isConnected || target !== control) return;
        const rect = control.getBoundingClientRect();
        const left = Math.max(12, Math.min(rect.left + rect.width / 2, window.innerWidth - 272));
        const top = rect.bottom + 42 < window.innerHeight ? rect.bottom + 8 : Math.max(8, rect.top - 38);
        control.setAttribute('aria-describedby', id);
        setHint({ text: text!, left, top });
      };
      if (immediate) reveal(); else timer = setTimeout(reveal, 350);
    };
    const over = (event: PointerEvent) => { if (event.pointerType !== 'touch') show(event.target); };
    const out = (event: PointerEvent) => { if (target && !(event.relatedTarget instanceof Node && target.contains(event.relatedTarget))) hide(); };
    const focus = (event: FocusEvent) => show(event.target, true);
    const key = (event: KeyboardEvent) => { if (event.key === 'Escape') hide(); };
    document.addEventListener('pointerover', over);
    document.addEventListener('pointerout', out);
    document.addEventListener('focusin', focus);
    document.addEventListener('focusout', hide);
    document.addEventListener('pointerdown', hide);
    document.addEventListener('click', hide);
    document.addEventListener('keydown', key);
    document.addEventListener('scroll', hide, true);
    window.addEventListener('resize', hide);
    return () => { hide(); document.removeEventListener('pointerover', over); document.removeEventListener('pointerout', out); document.removeEventListener('focusin', focus); document.removeEventListener('focusout', hide); document.removeEventListener('pointerdown', hide); document.removeEventListener('click', hide); document.removeEventListener('keydown', key); document.removeEventListener('scroll', hide, true); window.removeEventListener('resize', hide); };
  }, [id]);
  return hint ? createPortal(<div id={id} role="tooltip" className="ops-action-hint" style={{ left: hint.left, top: hint.top }}>{hint.text}</div>, document.body) : null;
}
