/* eslint-disable @next/next/no-img-element -- Authenticated private photos and local blob previews bypass the public image optimizer. */
import { useEffect, useRef, useState } from 'react';
import { Camera, ImagePlus, X } from 'lucide-react';
import { Button } from './components/ui/button';
import type { CommercialOperation, ResaleRecord } from './lib/commercial-contract';
import { MAX_RESALE_PHOTO_BYTES, MAX_RESALE_PHOTOS, RESALE_PHOTO_TYPES } from '../lib/resale-photo-limits';
import './resale-photos.css';

type SelectedPhoto = { id: string; file: File; preview: string };
export function ResaleItemEditor({ initial, date, onBusyChange, onSaved }: { initial: ResaleRecord; date: string; onBusyChange: (busy: boolean) => void; onSaved: () => void }) {
  const [draft, setDraft] = useState(initial);
  const [photos, setPhotos] = useState<SelectedPhoto[]>([]);
  const [uploaded, setUploaded] = useState<string[]>([]);
  const [busy, setBusy] = useState(false), [locked, setLocked] = useState(false), [itemSaved, setItemSaved] = useState(false);
  const [error, setError] = useState(''), [progress, setProgress] = useState('');
  const operation = useRef<CommercialOperation | null>(null), active = useRef(false);
  const previews = useRef(new Set<string>());
  const library = useRef<HTMLInputElement>(null), camera = useRef<HTMLInputElement>(null);
  useEffect(() => { const urls = previews.current; return () => { urls.forEach(url => URL.revokeObjectURL(url)); }; }, []);
  useEffect(() => {
    if (!busy) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [busy]);
  function select(files: FileList | null) {
    if (!files || locked || active.current) return;
    setError('');
    const selected = [...files];
    if ((draft.photos?.length || 0) + photos.length + selected.length > MAX_RESALE_PHOTOS) { setError(`Choose up to ${MAX_RESALE_PHOTOS} photos per item.`); return; }
    const invalid = selected.find(file => !RESALE_PHOTO_TYPES.includes(file.type as typeof RESALE_PHOTO_TYPES[number]) || !file.size || file.size > MAX_RESALE_PHOTO_BYTES);
    if (invalid) { setError(`${invalid.name}: choose a JPEG or PNG up to 10 MB. Export HEIC photos as JPEG first.`); return; }
    setPhotos(current => [...current, ...selected.map(file => { const preview = URL.createObjectURL(file); previews.current.add(preview); return { id: crypto.randomUUID(), file, preview }; })]);
  }
  async function save() {
    if (active.current) return;
    active.current = true; setBusy(true); onBusyChange(true); setError(''); setLocked(true);
    try {
      if (!itemSaved) {
        setProgress('Saving and verifying item…');
        operation.current ||= { action: 'resale.save', recordId: draft.itemId, expectedVersion: draft.version, values: { ...draft }, date, requestId: crypto.randomUUID() };
        const response = await fetch('/api/desktop/finance', { method: 'POST', signal: AbortSignal.timeout(30_000), headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(operation.current) });
        const result = await response.json();
        if (!response.ok) {
          if (result.stage === 'preflight') { operation.current = null; setLocked(false); }
          throw new Error(result.error || 'Item save could not be confirmed.');
        }
        if (result.receipt?.status !== 'verified') throw new Error('Item save is not verified. Check the saved result before uploading photos.');
        setItemSaved(true);
      }
      for (const [index, photo] of photos.entries()) {
        if (uploaded.includes(photo.id)) continue;
        setProgress(`Uploading photo ${index + 1} of ${photos.length}…`);
        const form = new FormData(); form.set('itemId', draft.itemId); form.set('photo', photo.file);
        const response = await fetch('/api/resale-items/photos', { method: 'POST', body: form, signal: AbortSignal.timeout(60_000) });
        const result = await response.json();
        if (!response.ok || !result.ok) throw new Error(`${photo.file.name}: ${result.error || 'Upload could not be confirmed.'}`);
        setUploaded(current => [...current, photo.id]);
      }
      onSaved();
    } catch (failure) {
      setError(`${failure instanceof Error ? failure.message : 'Connection interrupted.'} Your selected photos remain here. Retry to continue safely, or close and reopen the item to inspect saved photos.`);
    } finally { active.current = false; setBusy(false); onBusyChange(false); setProgress(''); }
  }
  return <form onSubmit={event => { event.preventDefault(); void save(); }}>
    <div className="record-drawer-body appointment-create-grid">
      <p>{draft.itemNumber || 'Item number assigned when saved'}</p>
      <section className="resale-photo-editor" aria-label="Item photos">
        <h3>Photos <span>({(draft.photos?.length || 0) + photos.length}/{MAX_RESALE_PHOTOS})</span></h3>
        <p>Add photos from your library or take a photo. JPEG or PNG, up to 10 MB each. Photos upload after the item is saved.</p>
        <input ref={library} hidden type="file" accept="image/jpeg,image/png" multiple aria-label="Choose resale photos" onChange={event => { select(event.target.files); event.target.value = ''; }} disabled={locked || busy}/>
        <input ref={camera} hidden type="file" accept="image/jpeg,image/png" capture="environment" aria-label="Take resale photo" onChange={event => { select(event.target.files); event.target.value = ''; }} disabled={locked || busy}/>
        <div className="resale-photo-picker"><Button type="button" variant="outline" disabled={locked || busy} onClick={() => library.current?.click()}><ImagePlus size={16}/>Choose photos</Button><Button type="button" variant="outline" disabled={locked || busy} onClick={() => camera.current?.click()}><Camera size={16}/>Take photo</Button></div>
        <div className="resale-photo-gallery">
          {draft.photos?.map((photo, index) => <a key={photo.photoId} href={`/api/resale-items/photos/${photo.photoId}`} target="_blank" rel="noreferrer" aria-label={`Open photo ${index + 1} of ${draft.itemName}`}><img src={`/api/resale-items/photos/${photo.photoId}`} alt={`${draft.itemName}, photo ${index + 1}`} loading="lazy" /></a>)}
          {photos.map(photo => <figure key={photo.id}><img src={photo.preview} alt={`Selected: ${photo.file.name}`} /><figcaption>{photo.file.name}<span>{uploaded.includes(photo.id) ? 'Saved' : 'Ready to upload'}</span></figcaption>{!locked && <button type="button" aria-label={`Remove ${photo.file.name}`} onClick={() => { setPhotos(current => current.filter(row => row.id !== photo.id)); URL.revokeObjectURL(photo.preview); previews.current.delete(photo.preview); }}><X size={16}/></button>}</figure>)}
        </div>
        {!draft.photos?.length && !photos.length && <p>No photos yet. You can save this item without photos.</p>}
      </section>
      <fieldset className="resale-item-fields" disabled={busy || locked}>
<label>Item name<input required maxLength={500} value={draft.itemName} onChange={event => setDraft({ ...draft, itemName: event.target.value })} /></label><label>Source job / custody reference<input required maxLength={500} value={draft.source} onChange={event => setDraft({ ...draft, source: event.target.value })} /></label><label>Acquired date<input required type="date" value={draft.acquiredDate} onChange={event => setDraft({ ...draft, acquiredDate: event.target.value })} /></label>{(['cost', 'askingPrice', 'soldPrice'] as const).map(field => <label key={field}>{field === 'cost' ? 'Recorded cost' : field === 'askingPrice' ? 'Asking price' : 'Sale amount (enter 0 if unsold)'}<input required type="number" min="0" step="0.01" value={Number.isFinite(draft[field]) ? draft[field] : ''} onChange={event => setDraft({ ...draft, [field]: event.target.value === '' ? NaN : Number(event.target.value) })} /></label>)}<label>Disposition<select value={draft.status} onChange={event => setDraft({ ...draft, status: event.target.value as ResaleRecord['status'] })}><option value="to_list">To list</option><option value="listed">Listed</option><option value="sold">Sold (receipt recorded)</option></select></label><label>Listing location / marketplace<input required={draft.status === 'listed'} maxLength={500} value={draft.marketplace} onChange={event => setDraft({ ...draft, marketplace: event.target.value })} /></label><label>Custody and sale evidence<textarea required={draft.status === 'sold'} maxLength={2000} value={draft.notes} onChange={event => setDraft({ ...draft, notes: event.target.value })} /></label>      </fieldset>
      <p>Saving records OpsCenter inventory evidence; it does not post to accounting.</p>
      {itemSaved && <p role="status">Item saved. {uploaded.length} of {photos.length} selected photos confirmed.</p>}
      {progress && <p role="status" aria-live="polite">{progress}</p>}
      {error && <p role="alert" className="resale-photo-error">{error}</p>}
    </div>
    <footer className="record-drawer-actions"><Button type="submit" disabled={busy}>{busy ? progress : itemSaved ? 'Retry remaining photos' : locked ? 'Check saved item & retry' : photos.length ? 'Save item & upload photos' : 'Save Inventory Record'}</Button></footer>
  </form>;
}
