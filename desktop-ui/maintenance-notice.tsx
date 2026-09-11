import { useEffect, useState } from 'react';
import type { MaintenanceSnapshot } from './lib/maintenance-contract';
import { maintenanceAttention } from '../lib/maintenance-attention';
import './maintenance-monitor.css';
export default function MaintenanceNotice({ onOpen }: { onOpen: () => void }) {
  const [snapshot, setSnapshot] = useState<MaintenanceSnapshot | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let alive = true;
    const refresh = async () => {
      try {
        const response = await fetch('/api/desktop/maintenance', { credentials: 'same-origin', cache: 'no-store', signal: AbortSignal.timeout(10_000) });
        if (!response.ok) throw new Error('unavailable');
        const result = await response.json(); if (alive) { setSnapshot(result); setFailed(false); }
      } catch { if (alive) setFailed(true); }
    };
    void refresh(); const timer = window.setInterval(() => void refresh(), 30_000);
    return () => { alive = false; window.clearInterval(timer); };
  }, []);
  const current = snapshot && { ...snapshot, fresh: snapshot.fresh && Date.now() - Date.parse(snapshot.checkedAt || '') < 180_000 && !failed };
  const attention = current ? maintenanceAttention(current) : null;
  if (!failed && (!attention || !attention.needsAttention)) return null;
  return <aside className="maintenance-notice" aria-label="System issues" role="status">
    <div><strong>{failed ? 'System issue status could not refresh' : attention?.summary}</strong><span>{attention?.issues.slice(0, 3).map(i => i.title).join(' · ')}{attention?.aiUnavailable ? `${attention.issues.length ? ' · ' : ''}${snapshot?.aiStatus}` : ''}</span></div>
    <button type="button" onClick={onOpen}>Review system issues</button>
  </aside>;
}
