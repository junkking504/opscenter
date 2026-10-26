"use client";

import { useId, useState, useSyncExternalStore } from 'react';
import SquishSwitch from './ui/squish-switch/SquishSwitch';
import '../styles/ops-theme.css';

type ThemeChoice = 'light' | 'dark' | 'system';
declare global {
  interface Window { OpsTheme?: { get: () => ThemeChoice; set: (value: ThemeChoice) => boolean }; }
}
const subscribe = (callback: () => void) => {
  window.addEventListener('ops-theme-change', callback);
  return () => window.removeEventListener('ops-theme-change', callback);
};
const snapshot = (): ThemeChoice => window.OpsTheme?.get() || 'system';
const resolvedSnapshot = () => document.documentElement.getAttribute('data-ops-theme') === 'dark';

export default function ThemeControl({ compact = false }: { compact?: boolean }) {
  const id = useId();
  const choice = useSyncExternalStore(subscribe, snapshot, () => 'system');
  const dark = useSyncExternalStore(subscribe, resolvedSnapshot, () => false);
  const [message, setMessage] = useState('');
  const apply = (value: ThemeChoice) => {
    const saved = window.OpsTheme?.set(value);
    setMessage(saved ? '' : 'Applied for this visit. Browser storage is unavailable.');
  };
  return <div className={`ops-theme-control${compact ? ' is-compact' : ''}`}>
    <div className="ops-theme-toggle" title={choice === 'system' ? 'Following device appearance' : undefined}>
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><circle cx="12" cy="12" r="4" /><path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5m11 11L19 19M5 19l1.5-1.5m11-11L19 5" /></svg>
      <SquishSwitch id={id} checked={dark} onChange={on => apply(on ? 'dark' : 'light')}
        ariaLabel="Dark mode" width={64} height={32} radius={16}
        trackColor="var(--oc-theme-switch-track)" trackOnColor="var(--oc-theme-switch-track-on)"
        thumbColor="var(--oc-theme-switch-thumb)" thumbOnColor="var(--oc-theme-switch-thumb-on)" />
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="M20.9 13A9 9 0 0 1 11 3.1 9 9 0 1 0 20.9 13Z" /></svg>
      <label htmlFor={id} className="ops-theme-current">{dark ? 'Dark' : 'Light'}</label>
    </div>
    {!compact && <>
      <button type="button" className="ops-theme-system" aria-pressed={choice === 'system'} onClick={() => apply('system')}>Use device setting</button>
      <p>{choice === 'system' ? 'Following your device appearance.' : 'Saved for this browser.'} Switch or drag to choose light or dark.</p>
    </>}
    <span role="status" className={compact ? 'ops-theme-status' : undefined}>{message}</span>
  </div>;
}
