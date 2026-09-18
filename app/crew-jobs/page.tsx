'use client';
import { useEffect, useRef, useState } from 'react';
import { CREW_PHONE_API, type CrewPhone } from '@/lib/crew-phone';
import styles from './phone-access.module.css';

const pendingKey = 'ops-crew-phone-enrollment-v1';
type Pending = { code: string; connectionKey: string };
export default function CrewPhoneSetup() {
  const [phone, setPhone] = useState<CrewPhone | null>(null);
  const [code, setCode] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const inFlight = useRef(false);
  async function refresh() {
    setLoading(true); setError('');
    try {
      const response = await fetch(CREW_PHONE_API, { cache: 'no-store' });
      const body = await response.json();
      if (response.status === 401) { setPhone(null); return; }
      if (!response.ok || !body.phone) throw new Error(body.error || 'Phone access could not be verified.');
      setPhone(body.phone);
      try { localStorage.removeItem(pendingKey); } catch { /* Connection is already verified. */ }
    } catch (error) { setError(error instanceof Error ? error.message : 'Phone access could not be verified.'); }
    finally { setLoading(false); }
  }
  useEffect(() => {
    try { const saved = JSON.parse(localStorage.getItem(pendingKey) || 'null') as Pending | null; if (saved?.code) setCode(saved.code); } catch { /* Setup reports storage failures before enrolling. */ }
    void refresh();
  }, []);
  async function enroll(event: React.FormEvent) {
    event.preventDefault();
    if (inFlight.current) return;
    inFlight.current = true; setBusy(true); setError('');
    try {
      const normalized = code.trim();
      let pending: Pending;
      try {
        const existing = JSON.parse(localStorage.getItem(pendingKey) || 'null') as Pending | null;
        pending = existing?.code === normalized && /^[a-f0-9]{64}$/.test(existing.connectionKey) ? existing : {
          code: normalized, connectionKey: Array.from(crypto.getRandomValues(new Uint8Array(32)), byte => byte.toString(16).padStart(2, '0')).join(''),
        };
        localStorage.setItem(pendingKey, JSON.stringify(pending));
      } catch { throw new Error('Allow browser storage on this company phone, then try setup again.'); }
      const response = await fetch(CREW_PHONE_API, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'enroll', ...pending }) });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || 'Setup could not be confirmed. Retry with this same code.');
      // Read with the cookie before dropping the recovery key or claiming setup.
      const check = await fetch(CREW_PHONE_API, { cache: 'no-store' });
      const saved = await check.json();
      if (!check.ok || saved.phone?.deviceId !== body.phone?.deviceId) throw new Error('The phone connection was not retained. Allow cookies, then retry with this same code.');
      setPhone(saved.phone);
      localStorage.removeItem(pendingKey);
    } catch (error) { setError(error instanceof Error ? error.message : 'Setup could not be confirmed. Retry with this same code.'); }
    finally { inFlight.current = false; setBusy(false); }
  }
  return <main className={styles.page}><div className={styles.content}>
    <header className={styles.header}><div className={styles.brand}>OpsCenter<small>CREW</small></div><span className={styles.badge}>{phone?.truck || 'Company phone'}</span></header>
    {loading ? <p role="status">Checking this phone…</p> : phone ? <>
      <h1>Phone connected</h1><p>{phone.label} · {phone.truck}</p>
      <section className={styles.card}><h2>Job access unavailable</h2><p>Contact dispatch for your current assignment.</p></section>
      <p className={styles.muted}>A manager controls this phone’s truck assignment and access.</p>
    </> : <><h1>Company phone setup</h1><p>Enter the setup code from your manager.</p>
      <form className={styles.form} onSubmit={enroll}><label>Setup code<input autoComplete="off" autoCapitalize="none" spellCheck={false} value={code} maxLength={24} onChange={event => setCode(event.target.value)} required disabled={busy}/></label>
      <button className={styles.primary} disabled={busy || code.trim().length !== 24}>{busy ? 'Connecting…' : 'Connect phone'}</button></form>
    </>}
    {error && <p className={styles.error} role="alert">{error}</p>}
    {!loading && <button className={styles.secondary} onClick={() => void refresh()} disabled={busy}>Check connection</button>}
  </div></main>;
}
