import { useId, useRef } from 'react';
import { Images, X } from 'lucide-react';
import type { DesktopAlert } from '../lib/live-contract';
import { AlertPhotos } from './alert-details';

export function CrewAlertPhotos({photos, title}: {photos: DesktopAlert['photos']; title: string}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const heading = useId();
  if (!photos?.length) return null;
  return <>
    <button type="button" className="crew-photo-button" aria-haspopup="dialog" onClick={() => dialog.current?.showModal()}><Images size={14}/>View {photos.length} photo{photos.length === 1 ? '' : 's'}</button>
    <dialog ref={dialog} className="crew-photo-dialog" aria-labelledby={heading}>
      <header><h3 id={heading}>{title} · Photos</h3><button type="button" aria-label="Close photos" onClick={() => dialog.current?.close()}><X size={19}/></button></header>
      <AlertPhotos photos={photos}/>
    </dialog>
  </>;
}
