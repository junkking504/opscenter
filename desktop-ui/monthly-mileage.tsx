import { MetricValue } from './metric-value';
import type { MonthlyTruckMileage } from '../lib/fleet-monthly-mileage';

export function MonthlyMileage({ mileage, date, compact = false }: { mileage?: MonthlyTruckMileage; date: string; compact?: boolean }) {
  const month = mileage?.month || date.slice(0, 7);
  const label = new Date(`${month}-01T12:00:00Z`).toLocaleDateString('en-US', { month: 'short', year: 'numeric', timeZone: 'America/Chicago' });
  const stamp = (value: string) => new Date(value).toLocaleString('en-US', { timeZone: 'America/Chicago', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short' });
  return <div className="convoy-monthly-mileage">
    <span className="convoy-fact-label">{compact ? label : `Monthly mileage · ${label}`}</span>
    <strong><MetricValue value={mileage?.recordedMiles == null ? null : `${mileage.recordedMiles.toLocaleString('en-US', { maximumFractionDigits: 1 })} mi recorded`} reason="No usable recorded mileage for the selected month" /></strong>
    {!compact && <details><summary>Mileage coverage</summary>
      <small>{mileage ? `${mileage.tripDays}/${mileage.expectedDays} days with trips · ${mileage.status === 'partial' ? 'Partial coverage' : 'No usable trip mileage'}` : 'Mileage source unavailable'}</small>
      <small>Saved LinxUp closed trips in America/Chicago through {mileage?.throughDate || date}. Missing days are not zero; recorded miles are not a complete monthly total.</small>
      {mileage && <small>{mileage.archiveDays}/{mileage.expectedDays} daily archives available. {mileage.excludedTrips} trips excluded; {mileage.duplicateTrips} duplicates removed.</small>}
      <small>Latest included trip: {mileage?.latestTripAt ? stamp(mileage.latestTripAt) : 'Unavailable'}</small>
      <small>Source collected: {mileage?.retrievedAt ? stamp(mileage.retrievedAt) : 'Unavailable'}</small>
    </details>}
  </div>;
}
