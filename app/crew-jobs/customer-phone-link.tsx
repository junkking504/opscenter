'use client';
import { useEffect, useId, useRef, useState } from 'react';
import styles from './phone-access.module.css';

export function customerPhoneHref(phone: string): string {
  const digits = String(phone || '').replace(/\D/g, '');
  if (digits.length === 10) return `tel:+1${digits}`;
  if (digits.length === 11 && digits.startsWith('1')) return `tel:+${digits}`;
  return digits.length >= 7 && digits.length <= 15 ? `tel:${digits}` : '';
}

export default function CustomerPhoneLink({ phone }: { phone: string }) {
  const href = customerPhoneHref(phone);
  const actionsId = useId();
  const [actionsOpen, setActionsOpen] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const startPoint = useRef<{ x: number; y: number } | null>(null);
  const suppressClick = useRef(false);
  const stopTimer = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    startPoint.current = null;
  };
  const openActions = () => {
    suppressClick.current = true;
    setActionsOpen(true);
  };
  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);
  if (!href) return <span className={styles.customerPhoneUnavailable}>Customer phone unavailable</span>;
  const smsHref = href.replace(/^tel:/, 'sms:');
  return <span className={styles.customerPhoneControl}>
    <a
      className={styles.customerPhone}
      href={href}
      aria-label={`Call ${phone}. Touch and hold for call or message options.`}
      aria-expanded={actionsOpen}
      aria-controls={actionsId}
      title="Tap to call. Touch and hold for call or message options."
      onPointerDown={event => {
        if (event.pointerType === 'mouse') return;
        stopTimer();
        startPoint.current = { x: event.clientX, y: event.clientY };
        timer.current = setTimeout(openActions, 550);
      }}
      onPointerMove={event => {
        const start = startPoint.current;
        if (start && Math.hypot(event.clientX - start.x, event.clientY - start.y) > 10) stopTimer();
      }}
      onPointerUp={stopTimer}
      onPointerCancel={stopTimer}
      onPointerLeave={stopTimer}
      onContextMenu={event => {
        event.preventDefault();
        stopTimer();
        openActions();
      }}
      onClick={event => {
        if (!suppressClick.current) return;
        event.preventDefault();
        suppressClick.current = false;
      }}
    >
      {phone}
      <small>Tap to call · touch and hold for call or message</small>
    </a>
    {actionsOpen && <span id={actionsId} className={styles.customerPhoneActions} role="group" aria-label={`Contact ${phone}`}>
      <a href={href} onClick={() => { suppressClick.current = false; }}>Call customer</a>
      <a href={smsHref} onClick={() => { suppressClick.current = false; }}>Message customer</a>
      <button type="button" onClick={() => { suppressClick.current = false; setActionsOpen(false); }}>Close</button>
    </span>}
  </span>;
}
