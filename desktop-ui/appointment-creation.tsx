import { useEffect, useRef, useState } from 'react';
import { X, ArrowRight } from 'lucide-react';
import { Button } from './components/ui/button';
import { Input } from './components/ui/input';
import { Textarea } from './components/ui/textarea';
import type { ScheduleAppointment } from './lib/schedule-contract';

type Receipt = { requestId: string; status: 'pending' | 'verified' | 'failed' | 'uncertain'; error?: string; code?: string; result?: { appointmentId: string; jkNumber: string; appointmentUrl: string; verifiedAt: string; date: string; truck: string } };
const franchises = ['New Orleans', 'Jefferson Parish', 'Northshore', 'Baton Rouge'];
const heard = ['Returning', 'Referral', 'Google - Search', 'Google - Ads', 'Google - Local Service Ad', 'Google - Maps', 'Website', 'Saw Trucks/Company Vehicle', 'Yelp', 'Thumbtack', 'TV/Radio', 'Online - Social', 'Angi Leads', 'Angi Ads', 'National Account', 'Neighborly', 'Networking/Events', 'Email/SMS', 'ChatGPT', 'Unknown'];
const freshForm = (date: string) => ({ franchise: '', date, startTime: '09:00', durationHours: 1, truck: '', appointmentType: 'Job', firstName: '', lastName: '', business: false, company: '', phone: '', email: '', billingSame: true, billingAddress: '', billingZip: '', billingEmail: '', howHeard: '', serviceAddress: '', serviceZip: '', serviceContactName: '', serviceContactPhone: '', estimatedPickups: 1, scope: '', notes: '', duplicateOverrideReason: '' });
export function creationPayload(form: ReturnType<typeof freshForm>, requestId: string) {
  return { ...form, requestId, billingAddress: form.billingSame ? form.serviceAddress : form.billingAddress, billingZip: form.billingSame ? form.serviceZip : form.billingZip };
}
export default function AppointmentCreation({ date, appointments, close, saved, onBusyChange }: { date: string; appointments: ScheduleAppointment[]; close: () => void; saved: () => void; onBusyChange: (busy: boolean) => void }) {
  const [form, setForm] = useState(() => freshForm(date));
  const [mode, setMode] = useState<'edit' | 'review' | 'result'>('edit');
  const [busy, setBusy] = useState(false);
  const pending = useRef(false);
  const [receipt, setReceipt] = useState<Receipt | null>(null);
  const [requestId, setRequestId] = useState('');
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const panel = useRef<HTMLElement>(null);
  const closeRef = useRef(close); closeRef.current = close;
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago' }).format(new Date());
  useEffect(() => { const prior = document.activeElement as HTMLElement | null; panel.current?.querySelector<HTMLButtonElement>('button')?.focus(); return () => { if (prior?.isConnected) prior.focus({ preventScroll: true }); }; }, []);
  useEffect(() => { onBusyChange(busy); return () => onBusyChange(false); }, [busy, onBusyChange]);
  useEffect(() => { const listener = (event: KeyboardEvent) => { if (event.key === 'Escape' && !pending.current) closeRef.current(); }; window.addEventListener('keydown', listener); return () => window.removeEventListener('keydown', listener); }, []);
  const update = <K extends keyof typeof form>(key: K, value: typeof form[K]) => { if (mode !== 'edit') return; setForm(current => ({ ...current, [key]: value })); setError(''); };
  const text = (key: keyof typeof form, label: string, type = 'text', required = false) => <label key={key}><span>{label}{required ? ' *' : ''}</span><Input type={type} value={String(form[key])} required={required} onChange={event => update(key, event.target.value as never)} /></label>;
  const select = (key: keyof typeof form, label: string, options: string[], numeric = false) => <label key={key}><span>{label} *</span><select value={String(form[key])} required onChange={event => update(key, (numeric ? Number(event.target.value) : event.target.value) as never)}><option value="" disabled>Choose</option>{options.map(option => <option key={option}>{option}</option>)}</select></label>;
  const matches = query.trim().length > 1 ? appointments.filter(job => [job.customerName, job.phone, job.address].join(' ').toLowerCase().includes(query.toLowerCase())).slice(0, 8) : [];
  const review = () => {
    if (!form.firstName.trim() || !form.lastName.trim() || !form.phone.trim() || !form.serviceAddress.trim() || !/^\d{5}(?:-\d{4})?$/.test(form.serviceZip) || !form.scope.trim() || !form.franchise || !form.truck || !form.howHeard) { setError('Complete the customer, contact, address, territory, truck, source and work fields.'); return; }
    if (form.date < today) { setError('Choose today or a future operating date.'); return; }
    setRequestId(crypto.randomUUID()); setReceipt(null); setError(''); setMode('review');
  };
  const accept = async (body: { receipt?: Receipt; error?: string }, status: number) => {
    if (!body.receipt) {
      if ([400, 401, 403, 409, 422].includes(status)) { setError(body.error || 'Booking was rejected.'); setMode('edit'); return; }
      throw new Error('The booking result could not be confirmed. Check Saved Result before doing anything else.');
    }
    setReceipt(body.receipt); setMode('result');
    if (body.receipt.status === 'verified') saved();
  };
  const submit = async () => {
    if (pending.current || mode !== 'review' || receipt) return;
    pending.current = true; setBusy(true); setError('');
    try {
      const response = await fetch('/api/desktop/schedule/creation', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(creationPayload(form, requestId)), signal: AbortSignal.timeout(240_000) });
      await accept(await response.json(), response.status);
    } catch { setReceipt({ requestId, status: 'uncertain', error: 'The booking result could not be confirmed. Check Saved Result and JunkWare before creating another appointment.' }); setMode('result'); }
    finally { pending.current = false; setBusy(false); }
  };
  const check = async () => {
    if (pending.current) return; pending.current = true; setBusy(true); setError('');
    try { const response = await fetch(`/api/desktop/schedule/creation?requestId=${encodeURIComponent(requestId)}`, { credentials: 'same-origin', cache: 'no-store' }); const body = await response.json(); if (!response.ok) throw new Error(body.error); await accept(body, response.status); }
    catch (failure) { setError(failure instanceof Error ? failure.message : 'Saved result unavailable.'); }
    finally { pending.current = false; setBusy(false); }
  };
  return <><button className="record-drawer-backdrop" aria-label="Close new appointment" disabled={busy} onClick={close} /><aside ref={panel} className="record-drawer appointment-create-drawer" role="dialog" aria-modal="true" aria-labelledby="new-appointment-title" onKeyDown={event => { if (event.key !== 'Tab') return; const elements = [...event.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), a[href]')]; const first = elements[0], last = elements.at(-1); if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); } else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); } }}>
    <header className="record-drawer-header"><div><span>{date}</span><h2 id="new-appointment-title">New Appointment</h2><p>Review the booking before JunkWare creates it and assigns its JK number.</p></div><Button variant="ghost" size="icon" aria-label="Close" disabled={busy} onClick={close}><X /></Button></header>
    <div className="record-drawer-body">
      {mode === 'edit' && <><section className="appointment-customer-lookup"><header><span>Customer</span><strong>Find an existing customer</strong><small>Search the loaded Schedule snapshot. JunkWare also checks its customer records when saving.</small></header><Input aria-label="Search existing customers" value={query} onChange={event => setQuery(event.target.value)} placeholder="Name, phone or service address" />{matches.map(job => <article key={job.recordId} className="appointment-customer-results"><div><strong>{job.customerName}</strong><small>{job.phone} · {job.address}</small></div><Button variant="outline" size="sm" onClick={() => { const [firstName, ...last] = job.customerName.trim().split(/\s+/); setForm(current => ({ ...current, firstName, lastName: last.join(' '), phone: job.phone || '', email: job.customerEmail || '', serviceAddress: job.address || '', serviceZip: job.address.match(/\b\d{5}(?:-\d{4})?\b/)?.[0] || '', howHeard: 'Returning' })); }}>Use Customer</Button></article>)}{query.length > 1 && !matches.length && <p>No match in this loaded snapshot.</p>}</section>
      <section className="appointment-create-section"><header><span>Customer</span><strong>Booking details</strong></header><div className="appointment-create-grid">{text('firstName', 'First name', 'text', true)}{text('lastName', 'Last name', 'text', true)}{text('phone', 'Phone', 'tel', true)}{text('email', 'Email', 'email')}{select('howHeard', 'How heard', heard)}<label><span>Customer type</span><select value={form.business ? 'business' : 'residential'} onChange={event => update('business', event.target.value === 'business')}><option value="residential">Residential</option><option value="business">Business</option></select></label>{form.business && text('company', 'Company', 'text', true)}</div></section>
      <section className="appointment-location-section"><header><div><span>Service Location</span><strong>Address and coverage</strong></div></header><div className="appointment-create-grid">{text('serviceAddress', 'Street address', 'text', true)}{text('serviceZip', 'ZIP', 'text', true)}{select('franchise', 'JunkWare franchise', franchises)}{text('serviceContactName', 'Service contact')}{text('serviceContactPhone', 'Contact phone', 'tel')}</div><p>JunkWare verifies the saved service address. No coordinates or coverage decision are guessed.</p></section>
      <section className="appointment-create-section"><header><span>Schedule</span><strong>Place the appointment</strong></header><div className="appointment-create-grid">{select('appointmentType', 'Category', ['Job', 'Estimate'])}{text('date', 'Date', 'date', true)}{select('startTime', 'Start time', Array.from({ length: 10 }, (_, index) => `${index + 8}`.padStart(2, '0') + ':00'))}{select('durationHours', 'Duration (hours)', Array.from({ length: 12 }, (_, index) => String(index + 1)), true)}{select('truck', 'Truck', Array.from({ length: 9 }, (_, index) => `Truck ${index + 1}`))}{select('estimatedPickups', 'Pickup-truck loads', Array.from({ length: 12 }, (_, index) => String((index + 1) / 2)), true)}{text('scope', 'Work description', 'text', true)}</div></section>
      <section className="appointment-create-section"><header><span>Billing and Notes</span><strong>Complete the record</strong></header><label><input type="checkbox" checked={form.billingSame} onChange={event => update('billingSame', event.target.checked)} /> Billing address matches service address</label><div className="appointment-create-grid">{!form.billingSame && text('billingAddress', 'Billing address', 'text', true)}{!form.billingSame && text('billingZip', 'Billing ZIP', 'text', true)}{text('billingEmail', 'Billing email', 'email')}<label className="wide"><span>Notes</span><Textarea value={form.notes} onChange={event => update('notes', event.target.value)} /></label>{receipt?.code === 'duplicate_appointment' && <label className="wide"><span>Reason for another matching appointment</span><Textarea value={form.duplicateOverrideReason} onChange={event => update('duplicateOverrideReason', event.target.value)} /></label>}</div></section></>}
      {mode === 'review' && <section className="appointment-create-section"><header><span>Review</span><strong>{form.appointmentType} · {form.firstName} {form.lastName}</strong></header><div className="drawer-facts">{[['Date', form.date], ['Window', `${form.startTime} · ${form.durationHours} hours`], ['Truck', form.truck], ['Franchise', form.franchise], ['Address', `${form.serviceAddress}, ${form.serviceZip}`], ['Work', form.scope], ['Phone', form.phone], ['JK Number', 'Assigned by JunkWare after verification']].map(([label, value]) => <div key={label}><span>{label}</span><strong>{value}</strong></div>)}</div><p>Creating this appointment writes to JunkWare. Customer and Krewe messages are separate actions.</p></section>}
      {mode === 'result' && receipt && <section className={`junkware-creation-status ${receipt.status}`} role="status"><header><span>{receipt.status === 'verified' ? 'Created and Verified' : receipt.status === 'failed' ? 'Not Created' : 'Verification Required'}</span><strong>{receipt.result?.jkNumber || receipt.error || 'Check the saved result before creating another appointment.'}</strong></header>{receipt.result && <div className="drawer-facts"><div><span>Appointment ID</span><strong>{receipt.result.appointmentId}</strong></div><div><span>JK Number</span><strong>{receipt.result.jkNumber}</strong></div><div><span>Verified at</span><strong>{new Date(receipt.result.verifiedAt).toLocaleString()}</strong></div></div>}<small>Request: {requestId}</small></section>}
      {busy && <p role="status">{mode === 'review' ? 'Creating and verifying in JunkWare…' : 'Reading saved result…'}</p>}{error && <p className="appointment-create-error" role="alert">{error}</p>}
    </div><footer className="record-drawer-actions"><Button variant="outline" disabled={busy} onClick={close}>Close</Button>{mode === 'edit' && <Button onClick={review}>Review Appointment <ArrowRight /></Button>}{mode === 'review' && <><Button variant="outline" disabled={busy} onClick={() => setMode('edit')}>Edit Details</Button><Button disabled={busy} onClick={submit}>Create in JunkWare</Button></>}{mode === 'result' && receipt?.status === 'failed' && <Button disabled={busy} onClick={() => setMode('edit')}>Review and Correct</Button>}{mode === 'result' && receipt?.status !== 'failed' && receipt?.status !== 'verified' && <Button disabled={busy} onClick={check}>Check Saved Result</Button>}{receipt?.result && <Button onClick={() => { saved(); close(); }}>Return to Schedule</Button>}</footer>
  </aside></>;
}
