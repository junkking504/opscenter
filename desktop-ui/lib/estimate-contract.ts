export type EstimateDisposition = 'needs_follow_up' | 'verify_booking' | 'waiting' | 'lost';
export type EstimateStatus = EstimateDisposition | 'converted';
export const estimateLabels: Record<EstimateStatus, string> = { needs_follow_up: 'Needs follow-up', verify_booking: 'Verify booking', waiting: 'Waiting on customer', lost: 'Lost / no longer needed', converted: 'Converted' };
export type EstimateFollowup = { status: EstimateDisposition; owner: string; nextFollowup: string; reason: string; lastContactAt: string | null };
export type EstimateEvent = { requestId: string; fingerprint: string; actor: string; at: string; note: string; contacted: boolean; before: EstimateFollowup; after: EstimateFollowup };
export type EstimateBooking = { id: string; jk: string; date: string; status: string; observedAt: string | null };
export type EstimateRow = {
  id: string; jk: string; customer: string; phone: string; email: string; address: string; territory: string;
  date: string; quote: number | null; observedAt: string | null; sourceStatus: string; notes: string[];
  photos: Array<{ url: string; category: string; fileName: string }>; pricing: string;
  status: EstimateStatus; followup: EstimateFollowup; history: EstimateEvent[]; tracked: boolean;
  bookings: EstimateBooking[]; canceledBookings: EstimateBooking[]; possibleBookings: EstimateBooking[];
  version: string; ageDays: number; overdue: boolean; dueToday: boolean;
};
export type EstimateSnapshot = { today: string; generatedAt: string; recentStart: string; rows: EstimateRow[]; coverage: { files: number; unreadable: number; latestObservation: string | null }; canWrite: boolean; actor: string };
export type EstimateSummary = { available: boolean; recentStart: string; review: number; unassigned: number; overdue: number; dueToday: number };
export type EstimateChange = { requestId: string; id: string; expectedVersion: string; status: EstimateDisposition; owner: string; nextFollowup: string; reason: string; note: string; contacted: boolean };
export const estimateHref = (id: string) => `https://junkware.junk-king.com/franchise/appointment.aspx?id=${id}`;
export function estimateInScope(row: EstimateRow, recentStart: string) { return row.date >= recentStart || row.tracked; }
export function estimateSummary(snapshot: EstimateSnapshot): EstimateSummary {
  const active = snapshot.rows.filter(row => estimateInScope(row, snapshot.recentStart) && row.status !== 'converted' && row.status !== 'lost');
  return { available: true, recentStart: snapshot.recentStart, review: active.filter(row => row.status === 'verify_booking').length, unassigned: active.filter(row => !row.followup.owner).length, overdue: active.filter(row => row.overdue).length, dueToday: active.filter(row => row.dueToday).length };
}
