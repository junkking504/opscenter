import { useCallback, useEffect, useRef, useState } from 'react';
import { Button } from './components/ui/button';
import { useWorkspaceRefresh } from './workspace-freshness';
import type { PhotoAppointmentOptions, PhotoAssignmentInput, PhotoAssignmentStatus, PhotoReviewRecord } from './lib/photo-review-contract';

export default function PhotoAssignment({ record, onStatus }: { record: PhotoReviewRecord; onStatus: (status: PhotoAssignmentStatus) => void }) {
  const [date, setDate] = useState(record.jobDate || '');
  const [options, setOptions] = useState<PhotoAppointmentOptions | null>(null);
  const [truck, setTruck] = useState('');
  const [search, setSearch] = useState('');
  const [appointmentId, setAppointmentId] = useState('');
  const [category, setCategory] = useState<PhotoAssignmentInput['category']>(['before', 'after', 'donation'].includes(record.category.toLowerCase()) ? record.category.toLowerCase() as PhotoAssignmentInput['category'] : 'after');
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [submitted, setSubmitted] = useState(record.state === 'assigned');
  const [receipt, setReceipt] = useState<PhotoAssignmentStatus | null>(null);
  useEffect(() => { if (receipt) onStatus(receipt); }, [receipt, onStatus]);
  // Keep the exact request after an uncertain response. A repeat is idempotent.
  const request = useRef<PhotoAssignmentInput | null>(null);
  const blocked = record.assignmentBlocked || (!record.revision ? 'Reload this record before assigning it.' : !record.previewAvailable ? 'The original photo is unavailable. Obtain a replacement before uploading.' : null);
  const selected = options?.appointments.find(row => row.appointmentId === appointmentId);
  const rows = options?.appointments.filter(row => (!truck || (row.truck || 'Unassigned') === truck) && `${row.jk} ${row.customer} ${row.address} ${row.appointmentId}`.toLowerCase().includes(search.trim().toLowerCase())) || [];
  const loadStatus = useCallback(async (signal: AbortSignal) => {
    const response = await fetch(`/api/desktop/photos?${new URLSearchParams({ record: record.id })}`, { credentials: 'same-origin', cache: 'no-store', signal });
    const body = await response.json();
    if (!response.ok) throw new Error(body.error || 'Upload status is unavailable.');
    if (!signal.aborted) setReceipt(body);
  }, [record.id]);
  const status = useWorkspaceRefresh(loadStatus, record.id, !submitted || Boolean(receipt?.verified));
  useEffect(() => {
    if (blocked || submitted || !date) return;
    const controller = new AbortController();
    setLoading(true); setError(''); setOptions(null); setAppointmentId(''); setConfirmed(false);
    void (async () => {
      try {
        const response = await fetch(`/api/desktop/photos?${new URLSearchParams({ appointments: date })}`, { credentials: 'same-origin', cache: 'no-store', signal: controller.signal });
        const body = await response.json();
        if (!response.ok) throw new Error(body.error || 'Appointments are unavailable.');
        if (!controller.signal.aborted) setOptions(body);
      } catch (failure) { if (!controller.signal.aborted) setError(failure instanceof Error ? failure.message : 'Appointments are unavailable.'); }
      finally { if (!controller.signal.aborted) setLoading(false); }
    })();
    return () => controller.abort();
  }, [date, blocked, submitted]);
  const submit = async () => {
    if (busy) return;
    if (!request.current) {
      if (!selected || !confirmed || !record.revision || !['review', 'failed'].includes(record.state)) return;
      request.current = { id: record.id, state: record.state as 'review' | 'failed', revision: record.revision, requestId: crypto.randomUUID(), date, appointmentId: selected.appointmentId, jk: selected.jk, category, confirmed: true };
    }
    setSubmitted(true); setBusy(true); setError('');
    try {
      const response = await fetch('/api/desktop/photos', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(request.current), signal: AbortSignal.timeout(30_000) });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || 'Assignment could not be confirmed.');
      setReceipt(body);
    } catch (failure) { setError(failure instanceof Error ? failure.message : 'The save response was lost. Check upload status before retrying.'); }
    finally { setBusy(false); }
  };
  if (submitted) return <section className="photo-assignment" aria-label="Photo assignment status">
    <h4>{receipt?.verified ? 'Upload verified' : 'Photo assignment'}</h4>
    <p role="status">{receipt?.message || 'Checking whether the assignment was saved…'}</p>
    {receipt?.appointment && <p><strong>{receipt.appointment.jk}</strong> · {receipt.appointment.date} · {receipt.appointment.truck || 'Unassigned truck'} · {receipt.category}<br />{receipt.appointment.customer} · {receipt.appointment.address}</p>}
    {error && <p role="alert" className="photo-review-warning">{error}</p>}
    {status.error && <p role="alert">{status.error} The previous result is retained.</p>}
    <div className="photo-assignment-actions">
      <Button type="button" variant="outline" size="sm" disabled={busy || status.pending} onClick={() => void status.refresh().catch(() => {})}>Check upload status</Button>
      {error && !receipt?.requestId && <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => void submit()}>Retry same assignment</Button>}
      {receipt?.appointment && <a href={`https://junkware.junk-king.com/franchise/appointment.aspx?id=${encodeURIComponent(receipt.appointment.appointmentId)}`} target="_blank" rel="noreferrer">Open appointment in JunkWare</a>}
    </div>
    {!receipt?.verified && <p className="photo-review-note">This view checks the saved result every 30 seconds while open. A saved assignment is not a verified upload.</p>}
  </section>;
  if (blocked) return <section className="photo-assignment"><h4>Assignment unavailable</h4><p>{blocked}</p><Button type="button" variant="outline" size="sm" onClick={() => setSubmitted(true)}>Check upload status</Button></section>;
  return <form className="photo-assignment" onSubmit={event => { event.preventDefault(); void submit(); }}>
    <h4>Assign this photo</h4>
    <p className="photo-review-note">Select the appointment this photo belongs to. Truck selection filters the list; this change applies only to this photo.</p>
    <div className="photo-assignment-fields">
      <label>Appointment date<input aria-label="Appointment date" type="date" required value={date} onChange={event => { setDate(event.target.value); setTruck(''); setAppointmentId(''); setConfirmed(false); }} /></label>
      <label>Truck<select aria-label="Truck" value={truck} onChange={event => { setTruck(event.target.value); setAppointmentId(''); setConfirmed(false); }}><option value="">All trucks</option>{[...new Set(options?.appointments.map(row => row.truck || 'Unassigned') || [])].sort().map(value => <option key={value}>{value}</option>)}</select></label>
      <label className="photo-assignment-wide">Find appointment<input aria-label="Find appointment" type="search" value={search} placeholder="JK number, customer, or address" maxLength={100} onChange={event => { setSearch(event.target.value); setAppointmentId(''); setConfirmed(false); }} /></label>
      <label className="photo-assignment-wide">Appointment<select aria-label="Appointment" required value={appointmentId} disabled={loading || !options} onChange={event => { setAppointmentId(event.target.value); setConfirmed(false); }}><option value="">{loading ? 'Loading appointments…' : 'Select an appointment'}</option>{rows.map(row => <option key={row.appointmentId} value={row.appointmentId}>{row.jk} · {row.customer} · {row.time || 'Time unavailable'} · {row.truck || 'Unassigned'}</option>)}</select></label>
      <label>Photo category<select aria-label="Photo category" value={category} onChange={event => { setCategory(event.target.value as PhotoAssignmentInput['category']); setConfirmed(false); }}><option value="before">Before</option><option value="after">After</option><option value="donation">Donation / receipt</option></select></label>
    </div>
    {options && <p className="photo-review-note">{rows.length} {rows.length === 1 ? 'appointment matches' : 'appointments match'}. {options.sourceAt ? `Schedule observed ${new Date(options.sourceAt).toLocaleString('en-US', { timeZone: 'America/Chicago' })} CT.` : 'Schedule source time unavailable; confirm the appointment details.'}</p>}
    {selected && <div className="photo-assignment-selection"><strong>{selected.jk} · {selected.customer}</strong><p>{selected.address || 'Address unavailable'}<br />{selected.date} · {selected.time || 'Time unavailable'} · {selected.truck || 'Unassigned truck'}<br />{selected.status} · Appointment {selected.appointmentId}</p><a href={`https://junkware.junk-king.com/franchise/appointment.aspx?id=${encodeURIComponent(selected.appointmentId)}`} target="_blank" rel="noreferrer">Review appointment in JunkWare</a></div>}
    <label className="photo-assignment-confirm"><input type="checkbox" checked={confirmed} disabled={!selected} onChange={event => setConfirmed(event.target.checked)} />I confirm this photo belongs to the selected appointment and category.</label>
    {error && <p role="alert" className="photo-review-warning">{error}</p>}
    <Button type="submit" variant="brand" disabled={busy || !confirmed || !selected || loading}>Assign and upload photo</Button>
  </form>;
}
