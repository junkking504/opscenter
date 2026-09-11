/* eslint-disable @next/next/no-img-element -- The Vite desktop uses direct, allowlisted JunkWare media with lazy loading. */
import { useState, type ReactNode } from 'react';
import type { DesktopAlert } from '../lib/live-contract';

export function AlertDetails({ children }: { children: ReactNode }) {
  return <div className="live-alert-details">{children}</div>;
}

function AlertPhoto({ photo }: { photo: NonNullable<DesktopAlert['photos']>[number] }) {
  const [failed, setFailed] = useState(false);
  return <a href={photo.url} target="_self" rel="noopener noreferrer" aria-label={`Open ${photo.category.toLowerCase()} photo: ${photo.fileName}`}>
    {failed ? <span className="alert-photo-unavailable">Preview unavailable · Open photo</span>
      : <img src={photo.url} alt={`${photo.category} job photo`} loading="lazy" decoding="async" onError={() => setFailed(true)} />}
    <span>{photo.category} photo</span>
  </a>;
}

export function AlertPhotos({ photos }: { photos: DesktopAlert['photos'] }) {
  if (!photos?.length) return null;
  return <div className="alert-photo-gallery" aria-label="Uploaded job photos">
    {photos.map(photo => <AlertPhoto key={photo.url} photo={photo} />)}
  </div>;
}
