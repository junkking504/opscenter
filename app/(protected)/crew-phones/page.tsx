'use client';
import { useEffect, useRef, useState } from 'react';
import { CREW_JOBS_ORIGIN, type CrewPhone, type CrewPhoneDirectory } from '@/lib/crew-phone';
import styles from '../../crew-jobs/phone-access.module.css';

type Phone = CrewPhone & { state: 'active' | 'expired' | 'revoked' };
type Enrollment = { code: string; deviceId: string; truck: string; label: string; expiresAt: string };
export default function CompanyPhones() {
  const [phones, setPhones] = useState<Phone[]>([]);
  const [directory,setDirectory]=useState<CrewPhoneDirectory>({company:[],managers:[]});
  const [trucks, setTrucks] = useState<string[]>([]);
  const [truck, setTruck] = useState('');
  const [label, setLabel] = useState('');
  const [enrollment, setEnrollment] = useState<Enrollment | null>(null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const inFlight = useRef(false);
  async function load() {
    setLoading(true); setError('');
    try {
      const response = await fetch('/api/crew-phones', { cache: 'no-store' });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Company phones could not be loaded.');
      setPhones(data.phones); setTrucks(data.trucks); setDirectory(data.directory || {company:[],managers:[]});
    } catch (error) { setError(error instanceof Error ? error.message : 'Company phones could not be loaded.'); }
    finally { setLoading(false); }
  }
  useEffect(() => { void load(); }, []);
  async function send(body: Record<string, unknown>) {
    if (inFlight.current) return;
    inFlight.current = true; setBusy(true); setError('');
    try {
      const response = await fetch('/api/crew-phones', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'The phone change could not be verified.');
      if (data.enrollment) setEnrollment(data.enrollment);
      if (data.phones) { setPhones(data.phones); if (body.deviceId === enrollment?.deviceId) setEnrollment(null); }
    } catch (error) { setError(error instanceof Error ? error.message : 'The phone change could not be verified. Refresh before trying again.'); }
    finally { inFlight.current = false; setBusy(false); }
  }
  return <main className={styles.page}><div className={styles.content}>
    <h1>Company phones</h1><p>Kingpin: <a href={CREW_JOBS_ORIGIN}>kingpin.junk-king.app</a></p><p>Set up job access on company-issued phones only. Each connection belongs to one truck.</p>
    <p>Managers can use personal phones with their manager accounts for <a href="/desktop?workspace=Schedule&scheduleDay=today&scheduleView=board">full schedule access</a>.</p><p><a href="/crew-dispatch">Open crew dispatch</a></p>
    {error && <p role="alert" className={styles.error}>{error}</p>}
    <section className={styles.card}><h2>Connect a phone</h2><form id="phone-setup-form" className={styles.form} onSubmit={event => { event.preventDefault(); void send({ action: 'enroll', truck, label }); }}>
      <label>Truck<select value={truck} onChange={event => {const selected=event.target.value;setTruck(selected);const contact=directory.company.find(phone=>phone.truck===selected);setLabel(contact?`${contact.label} · ${contact.number}`:"");}} required disabled={busy || loading}><option value="">Choose truck</option>{trucks.map(item => <option key={item}>{item}</option>)}</select></label>
      <label>Phone name<input value={label} onChange={event => setLabel(event.target.value)} maxLength={80} placeholder="Truck 6 company phone" required disabled={busy || loading}/></label>
      <button className={styles.primary} disabled={busy || loading || !truck || !label.trim()}>Create setup code</button>
    </form></section>
    {enrollment && <section className={styles.card} aria-live="polite"><h2>{enrollment.label}</h2><p>{enrollment.truck}</p><p>On the company phone, open <a href={CREW_JOBS_ORIGIN}>kingpin.junk-king.app</a> and enter this 6-digit code:</p><p className={styles.code}>{enrollment.code}</p><p>Expires {new Date(enrollment.expiresAt).toLocaleTimeString([], {hour:'numeric', minute:'2-digit'})}. Usable by one phone.</p><button className={styles.secondary} disabled={busy} onClick={() => void send({ action: 'revoke', deviceId: enrollment.deviceId })}>Cancel this setup code</button></section>}
    {directory.company.length>0 && <section className={styles.card}><h2>Company phone directory</h2><p>Select a phone to prepare its setup code.</p><ul className={styles.list}>{directory.company.map(contact=><li key={contact.truck}><strong>{contact.label} · {contact.truck}</strong><a href={`tel:+1${contact.number.replace(/-/g,'')}`}>{contact.number}</a><div><button className={styles.secondary} disabled={busy || loading} onClick={()=>{setTruck(contact.truck);setLabel(`${contact.label} · ${contact.number}`);document.getElementById('phone-setup-form')?.scrollIntoView({behavior:'smooth'});}}>Select {contact.label}</button></div></li>)}</ul></section>}
    {directory.managers.length>0 && <section className={styles.card}><h2>Manager phones</h2><p>Personal phones · full schedule through manager sign-in.</p><ul className={styles.list}>{directory.managers.map(contact=><li key={contact.name}><strong>{contact.name}</strong><a href={`tel:+1${contact.number.replace(/-/g,'')}`}>{contact.number}</a></li>)}</ul></section>}
    <h2>Enrolled phones</h2><button className={styles.secondary} onClick={() => void load()} disabled={busy || loading}>{loading ? 'Loading…' : 'Refresh phones'}</button>
    {!loading && !phones.length && !error && <p>No company phones enrolled.</p>}
    <ul className={styles.list}>{phones.map(phone => <li key={phone.deviceId}><strong>{phone.label}</strong><span>{phone.truck} · {phone.state}</span>{phone.state === 'active' && <button className={styles.secondary} disabled={busy} onClick={() => void send({ action: 'revoke', deviceId: phone.deviceId })}>Remove access</button>}</li>)}</ul>
    <p className={styles.muted}>To change trucks, remove the old connection and create a new setup code.</p>
  </div></main>;
}
