import { osmTravelMatrix } from './osm-travel-matrix';
import { type DesktopAppointment } from './desktop-schedule';

// Keep the dispatcher's first stop, then choose the shortest available road
// distance from each stop. This is a suggestion, not a global route optimum.
export async function nearestStopOrder(jobs: DesktopAppointment[], provider = osmTravelMatrix): Promise<DesktopAppointment[]> {
  if (jobs.length > 12) throw new Error('Use the arrows for time slots with more than 12 appointments.');
  if (jobs.some(job=>!job.location)) throw new Error('Verify every address in this time slot before suggesting an order.');
  if (jobs.length < 2) return [...jobs];
  const result = [jobs[0]], remaining = jobs.slice(1);
  while (remaining.length) {
    // No distance comparison remains when only one stop is left. The preview
    // independently verifies that last travel leg before displaying its ETA.
    if (remaining.length === 1) { result.push(remaining[0]); break; }
    const matrix = await provider([result.at(-1)!.location!],remaining.map(job=>job.location!));
    const distances = remaining.map((_,index)=>matrix?.find(row=>(row.originIndex ?? 0) === 0 && (row.destinationIndex ?? 0) === index));
    if (distances.some(row=>!row || row.status?.code || row.condition !== 'ROUTE_EXISTS' || typeof row.distanceMeters !== 'number' || !Number.isFinite(row.distanceMeters) || row.distanceMeters < 0)) throw new Error('Some road distances are unavailable. Use the arrows or try again.');
    const next = distances.reduce((best,row,index)=>row!.distanceMeters! < distances[best]!.distanceMeters! ? index : best,0);
    result.push(remaining.splice(next,1)[0]);
  }
  return result;
}
