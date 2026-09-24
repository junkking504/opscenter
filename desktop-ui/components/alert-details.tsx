/* eslint-disable @next/next/no-img-element -- The Vite desktop uses direct, allowlisted JunkWare media with lazy loading. */
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ChevronLeft, ChevronRight, X } from 'lucide-react';
import type { DesktopAlert } from '../lib/live-contract';

export function AlertDetails({ children }: { children: ReactNode }) {
  return <div className="live-alert-details">{children}</div>;
}

type AlertPhotoRecord = NonNullable<DesktopAlert['photos']>[number];

function AlertPhoto({ photo, open }: { photo: AlertPhotoRecord; open: () => void }) {
  const [failed, setFailed] = useState(false);
  return <button type="button" onClick={open} aria-haspopup="dialog" aria-label={`Enlarge ${photo.category.toLowerCase()} photo: ${photo.fileName}`}>
    {failed ? <span className="alert-photo-unavailable">Preview unavailable</span>
      : <img src={photo.url} alt={`${photo.category} job photo`} loading="lazy" decoding="async" onError={() => setFailed(true)} />}
    <span>{photo.category} photo</span>
  </button>;
}

export function AlertPhotos({ photos }: { photos: DesktopAlert['photos'] }) {
  const [selected, setSelected] = useState<number | null>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  const returnFocus = useRef<HTMLElement | null>(null);
  const list = photos || [];
  useEffect(() => {
    if (selected === null || document.activeElement?.closest('.appointment-photo-lightbox')) return;
    closeButton.current?.focus({ preventScroll: true });
  }, [selected]);
  if (!photos?.length) return null;
  const close = () => {
    setSelected(null);
    requestAnimationFrame(() => returnFocus.current?.focus({ preventScroll: true }));
  };
  const cycle = (step: number) => setSelected(index => index === null ? 0 : (index + step + list.length) % list.length);
  const open = (index: number) => {
    returnFocus.current = document.activeElement as HTMLElement | null;
    setSelected(index);
  };
  const photo = selected === null ? null : list[selected];
  return <>
    <div className="alert-photo-gallery" aria-label="Uploaded job photos">
      {list.map((item, index) => <AlertPhoto key={item.url} photo={item} open={() => open(index)} />)}
    </div>
    {photo && <div className="appointment-photo-lightbox" role="dialog" aria-modal="true" aria-label="Photo gallery" onClick={event => { if (event.target === event.currentTarget) close(); }} onKeyDown={event => {
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(); }
      if (event.key === 'ArrowLeft') { event.preventDefault(); cycle(-1); }
      if (event.key === 'ArrowRight') { event.preventDefault(); cycle(1); }
    }}>
      <div className="appointment-photo-lightbox-panel">
        <header><div><strong>{photo.category} photo</strong><span>{selected! + 1} of {list.length}</span></div><button ref={closeButton} type="button" aria-label="Close photo gallery" onClick={close}><X size={22} /></button></header>
        <figure><img src={photo.url} alt={`${photo.category} job photo, enlarged`} /><figcaption>{photo.fileName}</figcaption></figure>
        <nav aria-label="Photo gallery controls"><button type="button" onClick={() => cycle(-1)} disabled={list.length < 2}><ChevronLeft size={20} />Previous</button><span>{selected! + 1} of {list.length}</span><button type="button" onClick={() => cycle(1)} disabled={list.length < 2}>Next<ChevronRight size={20} /></button></nav>
      </div>
    </div>}
  </>;
}
