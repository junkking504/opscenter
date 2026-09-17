import { useEffect, useState } from 'react';
import type { ScheduleTruck } from './lib/schedule-contract';
import { watchTruckAddress } from '../lib/truck-address-client';

// Reuse Fleet's existing non-Google lookup for the selected truck only.
export function TruckPosition({ truck }: { truck?: ScheduleTruck }) {
  const latitude = truck?.latitude, longitude = truck?.longitude;
  const reportedAddress = truck?.lastKnownAddress;
  const truckName = truck?.truck || '';
  const key = latitude != null && longitude != null ? `${latitude.toFixed(5)},${longitude.toFixed(5)}` : '';
  const [result, setResult] = useState({ truck: '', key: '', address: '', stale: false });
  useEffect(() => {
    if (!key) return;
    if (reportedAddress) {
      setResult({truck:truckName, key, address:reportedAddress, stale:false});
      return;
    }
    const [lat, lon] = key.split(',').map(Number);
    return watchTruckAddress(lat, lon, address => setResult({truck:truckName, key, ...address}));
  }, [key, reportedAddress, truckName]);
  const saved = result.truck === truckName ? result.address : '';
  return <div><dt>Street address</dt><dd aria-live="polite">{reportedAddress || (saved ? <>{`Near ${saved}`}{result.key !== key ? ' · Previous location; updating street address…' : result.stale ? ' · Saved address; refreshing…' : ''}</> : !key ? 'Position unavailable' : 'Finding street address · retrying automatically…')}</dd></div>;
}
