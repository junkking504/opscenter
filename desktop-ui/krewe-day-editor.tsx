import { useCallback, useEffect, useRef, useState } from 'react';
import type { DesktopKreweDay } from './lib/people-fleet-contract';
import './krewe-day-editor.css';

type Action = 'correction' | 'bonus';
type SavedRequest = { id: string; action: Action };
const clockInput = (value: string) => {
  const match = value.trim().match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
  if (!match) return /^\d{2}:\d{2}$/.test(value) ? value : '';
  return `${String(Number(match[1]) % 12 + (match[3].toUpperCase() === 'PM' ? 12 : 0)).padStart(2, '0')}:${match[2]}`;
};
const clockDisplay = (value: string) => {
  if (!value) return '';
  const [hour, minute] = value.split(':').map(Number);
  return `${hour % 12 || 12}:${String(minute).padStart(2, '0')} ${hour >= 12 ? 'PM' : 'AM'}`;
};
const money = (amount: number) => amount.toLocaleString('en-US', {style:'currency',currency:'USD'});

export default function KreweDayEditor({ date, periodDate, name, action, onClose, onSaved }: {
  date: string; periodDate: string; name: string; action: Action; onClose: () => void; onSaved: () => Promise<void>;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const busy = useRef(false);
  const [pending, setPending] = useState(false);
  const [record, setRecord] = useState<DesktopKreweDay | null>(null);
  const [message, setMessage] = useState('');
  const [request, setRequest] = useState<SavedRequest | null>(null);
  const [draft, setDraft] = useState({clockIn:'',clockOut:'',hourlyRate:'',note:'',amount:'',bonusNote:''});
  const storageKey = `krewe-day-pending:${date}:${name}`;
  const load = useCallback(async (signal?: AbortSignal) => {
    const params = new URLSearchParams({date,periodDate,employee:name});
    const response = await fetch(`/api/desktop/krewe?${params}`, {credentials:'same-origin',cache:'no-store',signal:signal || AbortSignal.timeout(30_000)});
    const body = await response.json();
    if (!response.ok) throw new Error(body.error || 'This day could not be loaded.');
    if (body.date !== date || !body.member) throw new Error('The selected day could not be confirmed.');
    if (signal?.aborted) return;
    setRecord(body);
    setDraft({clockIn:clockInput(body.member.clockIn),clockOut:clockInput(body.member.clockOut),hourlyRate:body.member.hourlyRate?.toString() || '',note:'',amount:'',bonusNote:''});
  }, [date,periodDate,name]);

  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    dialog.current?.showModal();
    const controller = new AbortController();
    try { const saved = sessionStorage.getItem(storageKey); if (saved) setRequest(JSON.parse(saved)); } catch { setMessage('Saved-result history is unavailable.'); }
    void load(AbortSignal.any([controller.signal,AbortSignal.timeout(30_000)])).catch(error => { if (!controller.signal.aborted) setMessage(error.message); });
    return () => { controller.abort(); opener?.focus(); };
  }, [load,storageKey]);

  function clearRequest() { sessionStorage.removeItem(storageKey); setRequest(null); }
  async function verified(saved: SavedRequest) {
    // Clear the submitted draft before any read can fail, preventing an accidental duplicate bonus.
    setDraft(previous => ({...previous,amount:'',bonusNote:'',note:''}));
    clearRequest();
    setRecord(null);
    setMessage(`${saved.action === 'bonus' ? 'Bonus' : 'Time correction'} saved and verified for ${date}.`);
    try { await load(); await onSaved(); }
    catch { setMessage(`Saved and verified for ${date}. Refresh the records to see updated hours and published pay.`); }
  }
  async function save(selectedAction: Action) {
    if (busy.current || request || !record?.canWrite) return;
    busy.current = true; setPending(true); setMessage('');
    const saved = {id:crypto.randomUUID(),action:selectedAction};
    try {
      sessionStorage.setItem(storageKey,JSON.stringify(saved)); setRequest(saved);
      const values = selectedAction === 'bonus' ? {amount:Number(draft.amount),note:draft.bonusNote} : {clockIn:clockDisplay(draft.clockIn),clockOut:clockDisplay(draft.clockOut),hourlyRate:Number(draft.hourlyRate),note:draft.note};
      const response = await fetch('/api/desktop/krewe', {method:'POST',credentials:'same-origin',signal:AbortSignal.timeout(30_000),headers:{'Content-Type':'application/json'},body:JSON.stringify({date,periodDate,name:record.member.name,action:selectedAction,values,requestId:saved.id,expectedVersion:record.member.actionVersions?.[selectedAction]})});
      const body = await response.json();
      if (body.receipt?.status === 'verified') await verified(saved);
      else if (body.receipt?.status === 'failed' || (!body.receipt && response.status >= 400 && response.status < 500)) {
        clearRequest(); setRecord(null); setMessage(body.error || 'Nothing was saved. Reload this day before trying again.');
      } else setMessage('Save result is unconfirmed. Check saved result before making another change.');
    } catch { setMessage('Save result is unconfirmed. Check saved result before making another change.'); }
    finally { busy.current = false; setPending(false); }
  }
  async function checkResult() {
    if (!request || busy.current) return;
    busy.current = true; setPending(true);
    try {
      const response = await fetch(`/api/desktop/krewe?receipt=${request.id}`,{credentials:'same-origin',cache:'no-store',signal:AbortSignal.timeout(30_000)});
      const body = await response.json();
      if (response.ok && body.receipt?.status === 'verified') await verified(request);
      else if (body.receipt?.status === 'failed') { clearRequest(); setRecord(null); setMessage('Nothing was saved. Reload this day before trying again.'); }
      else setMessage('The saved result is still unconfirmed. Review the recorded state before another change.');
    } catch { setMessage('Saved result could not be checked. Try checking again when the connection returns.'); }
    finally { busy.current = false; setPending(false); }
  }
  async function reload() {
    if (busy.current) return;
    busy.current=true; setPending(true);
    try { await load(); setMessage('Current day loaded. Review the values before saving.'); }
    catch (error) { setMessage(error instanceof Error ? error.message : 'This day could not be loaded.'); }
    finally { busy.current=false; setPending(false); }
  }
  const disabled = pending || Boolean(request) || !record?.canWrite;
  return <dialog className="krewe-day-editor" ref={dialog} aria-labelledby="krewe-day-title" onCancel={event => {event.preventDefault(); if (!busy.current) onClose();}}>
    <header><div><span>Work date · {date}</span><h2 id="krewe-day-title">{name}</h2></div><button type="button" disabled={pending} onClick={onClose} aria-label="Close day editor">×</button></header>
    <p>Changes apply only to {date}. Original JunkWare records are preserved. Hours update from corrections; published payroll may need reconciliation.</p>
    {message && <p className="krewe-day-feedback" role="status">{message}</p>}
    {request && <button type="button" disabled={pending} onClick={() => void checkResult()}>Check saved result</button>}
    {!record && <><p>{pending ? 'Working…' : 'Load this day’s current record to edit.'}</p><button type="button" disabled={pending} onClick={() => void reload()}>Reload this day</button></>}
    {record && <>
      <p>{record.member.status} · {record.member.clockIn || 'No clock-in'} – {record.member.clockOut || 'No clock-out'}</p>
      {record.member.hourlyRate === null && <p>No rate is recorded for this date. Enter the applicable hourly rate to correct time.</p>}
      {!record.canWrite && <p>Manager write access is required to make changes.</p>}
      <form onSubmit={event => {event.preventDefault(); void save('correction');}}>
        <h3>Edit hours</h3><fieldset disabled={disabled}>
          <div className="krewe-day-fields"><label>Clock-in<input type="time" required autoFocus={action === 'correction'} value={draft.clockIn} onChange={e=>setDraft({...draft,clockIn:e.target.value})}/></label><label>Clock-out<input type="time" value={draft.clockOut} onChange={e=>setDraft({...draft,clockOut:e.target.value})}/></label><label>Hourly rate<input type="number" min="0.01" step="0.01" required value={draft.hourlyRate} onChange={e=>setDraft({...draft,hourlyRate:e.target.value})}/></label></div>
          <label>Correction reason<input required value={draft.note} onChange={e=>setDraft({...draft,note:e.target.value})}/></label>
          <button type="submit" disabled={!draft.note.trim() || !draft.clockIn || !(Number(draft.hourlyRate)>0)}>Save hours</button>
        </fieldset>
      </form>
      <form onSubmit={event => {event.preventDefault(); void save('bonus');}}>
        <h3>Manual bonus</h3><fieldset disabled={disabled}>
          <div className="krewe-day-fields"><label>Bonus amount<input type="number" min="0.01" step="0.01" required autoFocus={action === 'bonus'} value={draft.amount} onChange={e=>setDraft({...draft,amount:e.target.value})}/></label><label>Bonus reason<input required value={draft.bonusNote} onChange={e=>setDraft({...draft,bonusNote:e.target.value})}/></label></div>
          <button type="submit" disabled={!draft.bonusNote.trim() || !(Number(draft.amount)>0)}>Save bonus</button>
        </fieldset>
      </form>
      {record.member.correction && <p>Last correction: {record.member.correction.note} · {record.member.correction.updatedBy} · {record.member.correction.updatedAt}</p>}
      {!!record.manualBonuses.length && <section aria-label="Saved manual bonuses"><h3>Saved manual bonuses · {date}</h3>{record.manualBonuses.map(bonus=><p key={bonus.entryId}><strong>{money(bonus.amount)}</strong> · {bonus.note}</p>)}</section>}
    </>}
  </dialog>;
}
