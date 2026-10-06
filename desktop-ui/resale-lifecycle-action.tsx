import { useRef, useState } from 'react';
import { Button } from './components/ui/button';
import type { CommercialOperation, ResaleRecord } from './lib/commercial-contract';

export function ResaleLifecycleAction({ item, date, onCancel, onBusyChange, onSaved }: { item: ResaleRecord; date: string; onCancel: () => void; onBusyChange: (busy: boolean) => void; onSaved: (message: string) => void }) {
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const active = useRef(false), operation = useRef<CommercialOperation | null>(null);
  const restoring = Boolean(item.deletedAt);
  async function submit() {
    if (active.current) return;
    active.current = true; setBusy(true); onBusyChange(true); setError('');
    operation.current ||= { action: restoring ? 'resale.restore' : 'resale.delete', recordId: item.itemId, expectedVersion: item.version, requestId: crypto.randomUUID(), date, values: {} };
    try {
      const response = await fetch('/api/desktop/finance', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(operation.current), signal: AbortSignal.timeout(30_000) });
      const result = await response.json();
      if (!response.ok || result.receipt?.status !== 'verified') throw new Error(result.error || 'The result could not be confirmed.');
      onSaved(result.receipt.message);
    } catch (failure) {
      setError(`${failure instanceof Error ? failure.message : 'Connection interrupted.'} Retry checks the same request safely. You can also close and refresh to inspect the item in All items or Deleted.`);
    } finally { active.current = false; setBusy(false); onBusyChange(false); }
  }
  return <section className="record-drawer-body resale-lifecycle" aria-label={restoring ? 'Confirm restoration' : 'Confirm deletion'}>
    <h3>{restoring ? 'Restore' : 'Delete'} “{item.itemName}”?</h3>
    <p>{item.itemNumber || item.itemId}</p>
    <p>{restoring ? 'Return this item to inventory with its original disposition, photos and evidence.' : 'Move this item to Deleted and hide it from active inventory. You can restore it from the Deleted filter.'}</p>
    <p>Saved photos, source references, cost and sale evidence are retained. Recorded sales and accounting records are unchanged.</p>
    {!restoring && <p>Unsaved edits and selected photos will not be saved.</p>}
    {error && <p role="alert" className="resale-photo-error">{error}</p>}
    <div className="resale-photo-picker">
      <Button type="button" variant="outline" autoFocus disabled={busy} onClick={onCancel}>Cancel</Button>
      <Button type="button" variant={restoring ? 'default' : 'destructive'} disabled={busy} onClick={() => void submit()}>{busy ? 'Verifying…' : error ? 'Retry safely' : restoring ? 'Restore item' : 'Delete item'}</Button>
    </div>
  </section>;
}
