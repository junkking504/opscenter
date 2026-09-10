// Parked LinxUp trackers report hourly. Keep the actual observation time and
// distinguish that cadence from live motion and from a missed heartbeat.
export const PARKED_GPS_MAX_AGE_MS = 75 * 60_000;

type TruckObservation = {
  lastGpsUpdate?: string | null;
  speed?: number | null;
  ignition?: string | null;
};

export function parkedTruckObservation(truck: TruckObservation): boolean {
  return truck.speed === 0 && truck.ignition?.trim().toUpperCase() === 'OFF';
}

export function truckGpsStatus(truck: TruckObservation | undefined, now = Date.now()) {
  const age = now - Date.parse(truck?.lastGpsUpdate || '');
  if (!truck || !Number.isFinite(age) || age < 0) {
    return { freshness: 'GPS unavailable', label: 'GPS unavailable', status: 'GPS unavailable', stale: true };
  }
  const parked = parkedTruckObservation(truck);
  if (parked && age <= PARKED_GPS_MAX_AGE_MS) {
    return { freshness: age <= 180_000 ? 'Live GPS' : 'Parked report', label: 'Parked · ignition off', status: 'Parked', stale: false };
  }
  if (age <= 180_000) {
    const status = typeof truck.speed === 'number' && truck.speed > 0 ? 'Driving'
      : truck.speed === 0 ? truck.ignition?.trim().toUpperCase() === 'ON' ? 'Idle' : 'Stopped'
      : 'Motion unavailable';
    return { freshness: 'Live GPS', label: status, status, stale: false };
  }
  const freshness = age > 120 * 60_000 ? 'Offline' : 'GPS Stale';
  return { freshness, label: parked ? 'GPS stale · last parked' : 'GPS stale · last known position', status: freshness, stale: true };
}
