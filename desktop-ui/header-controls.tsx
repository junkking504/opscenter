import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Activity, UserRound } from 'lucide-react';
import { Button } from './components/ui/button';
import { useHeaderPanel } from './header-panel';
import './header-controls.css';

export default function HeaderControls({ generatedAt, loading, attention, name, role, refresh, children }: {
  generatedAt: string; loading?: boolean; attention: boolean; name: string; role: string;
  refresh?: () => Promise<void>; children: ReactNode;
}) {
  const [panel, setPanel] = useState<'live' | 'user' | null>(null);
  const [host, setHost] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const [checkedAt, setCheckedAt] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setTimeout(() => setCheckedAt(Date.now()), Math.max(0, Date.parse(generatedAt) + 300_001 - Date.now()));
    return () => window.clearTimeout(timer);
  }, [generatedAt]);
  const live = useRef<HTMLDivElement>(null), user = useRef<HTMLDivElement>(null);
  useHeaderPanel('live', panel === 'live', () => setPanel(null), live);
  useHeaderPanel('user', panel === 'user', () => setPanel(null), user);
  const status = loading ? 'Loading' : attention ? 'Source attention' : checkedAt - Date.parse(generatedAt) > 300_000 ? 'Last updated' : 'Live';
  return <>
    <div className="header-disclosure header-live" ref={live}>
      <Button variant="outline" aria-expanded={panel === 'live'} aria-controls="header-live-panel" onClick={() => { setHost(window.location.host); setPanel(panel === 'live' ? null : 'live'); }}><Activity size={14} />{status}</Button>
      {panel === 'live' && <section id="header-live-panel" className="header-popover" role="dialog" aria-label="Live status">
        <strong>{status}</strong><dl><dt>Dashboard last updated</dt><dd>{new Date(generatedAt).toLocaleString('en-US', { timeZone: 'America/Chicago' })} CT</dd><dt>Host</dt><dd>{host}</dd></dl>
        <Button variant="outline" disabled={!refresh || pending} onClick={async () => { if (!refresh) return; setPending(true); setError(''); try { await refresh(); } catch (failure) { setError(failure instanceof Error ? failure.message : 'Refresh failed. Previous data retained.'); } finally { setPending(false); } }}>{pending ? 'Refreshing…' : 'Refresh displayed data'}</Button>
        {error && <p role="alert">{error}</p>}
      </section>}
    </div>
    <div className="header-disclosure header-user" ref={user}>
      <Button variant="outline" aria-label={`User menu: ${name}`} aria-expanded={panel === 'user'} aria-controls="header-user-panel" onClick={() => setPanel(panel === 'user' ? null : 'user')}><UserRound size={14} /><span>{name}</span></Button>
      {panel === 'user' && <section id="header-user-panel" className="header-popover" role="dialog" aria-label="User settings"><strong>{name}</strong><p>{role}</p>{children}</section>}
    </div>
  </>;
}
