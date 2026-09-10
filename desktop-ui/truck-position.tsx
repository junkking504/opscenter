import { useEffect, useState } from 'react';
import type { ScheduleTruck } from './lib/schedule-contract';

// Reuse Fleet's existing non-Google lookup for the selected truck only.
export function TruckPosition({ truck }: { truck?: ScheduleTruck }) {
  const latitude = truck?.latitude, longitude = truck?.longitude;
  const key = latitude != null && longitude != null ? `${latitude.toFixed(5)},${longitude.toFixed(5)}` : '';
  const [result, setResult] = useState({ key: '', address: '' });
  useEffect(() => {
    if (!key) return;
    const controller = new AbortController();
    const [lat, lon] = key.split(',').map(Number);
    fetch('/api/fleet-location-address', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ latitude: lat, longitude: lon }), signal: controller.signal,
    }).then(async response => response.ok ? response.json() : null)
      .then(payload => { if (!controller.signal.aborted) setResult({ key, address: String(payload?.address || '').trim() }); })
      .catch(() => { if (!controller.signal.aborted) setResult({ key, address: '' }); });
    return () => controller.abort();
  }, [key]);
  return <div><dt>Last position</dt><dd aria-live="polite">{!key ? 'Position unavailable' : result.key !== key ? 'Finding street address…' : result.address || 'Street address unavailable for this GPS position'}</dd></div>;
}
