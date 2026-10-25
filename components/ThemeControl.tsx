"use client";

import { useId, useState, useSyncExternalStore } from 'react';
import '../styles/ops-theme.css';

type ThemeChoice = 'light' | 'dark' | 'system';
declare global {
  interface Window { OpsTheme?: { get: () => ThemeChoice; set: (value: ThemeChoice) => boolean }; }
}
const subscribe = (callback: () => void) => {
  window.addEventListener('ops-theme-change', callback);
  return () => window.removeEventListener('ops-theme-change', callback);
};
const snapshot = (): ThemeChoice => typeof window === 'undefined' ? 'system' : window.OpsTheme?.get() || 'system';

export default function ThemeControl({ compact = false }: { compact?: boolean }) {
  const id = useId();
  const choice = useSyncExternalStore(subscribe, snapshot, () => 'system');
  const [message, setMessage] = useState('');
  return <div className={`ops-theme-control${compact ? ' is-compact' : ''}`}>
    <label htmlFor={id}>Theme</label>
    <select id={id} value={choice} aria-describedby={compact ? undefined : `${id}-note`} onChange={event => {
      const value = event.target.value as ThemeChoice;
      const saved = window.OpsTheme?.set(value);
      setMessage(saved ? '' : 'Applied for this visit. Browser storage is unavailable.');
    }}>
      <option value="light">Light</option><option value="dark">Dark</option><option value="system">System</option>
    </select>
    {!compact && <p id={`${id}-note`}>Saved for this browser. System follows your device appearance.</p>}
    <span role="status" className={compact ? 'ops-theme-status' : undefined}>{message}</span>
  </div>;
}
