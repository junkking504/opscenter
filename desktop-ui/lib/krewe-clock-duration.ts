import { chicagoDateKey } from '../../lib/chicago-date';
import type { DesktopCrewMember } from './people-fleet-contract';

/** Elapsed punch time is separate from published payroll hours. Open shifts
 * advance locally, without additional requests or borrowing another date. */
export function clockDurationLabel(member: Pick<DesktopCrewMember, 'clockInAt' | 'clockOutAt' | 'clockOut'>, date: string, now: number): string {
  const start = member.clockInAt;
  const closed = member.clockOutAt != null;
  if (start == null || !Number.isFinite(start) || (member.clockOut && !closed)) return 'Hours unavailable';
  if (!closed && date !== chicagoDateKey(new Date(now))) return 'Missing clock-out';
  const end = closed ? member.clockOutAt! : now;
  const elapsed = end - start;
  if (!Number.isFinite(elapsed) || elapsed < 0 || elapsed > 18 * 60 * 60 * 1000) return 'Hours need review';
  const minutes = Math.floor(elapsed / 60_000);
  return `${Math.floor(minutes / 60)}h ${String(minutes % 60).padStart(2, '0')}m ${closed ? 'total' : 'on clock'}`;
}
