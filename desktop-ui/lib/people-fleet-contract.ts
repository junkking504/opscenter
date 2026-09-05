export type KreweView = 'today' | 'callin' | 'payperiod' | 'monthly';
export type FleetView = 'overview' | 'maintenance' | 'service' | 'reports';
export type DesktopWorkspaceProps<V extends string> = { date: string; view: V; report?: string; onViewChange?: (view: V) => void; onBusyChange?: (busy: boolean) => void };
export type CrewAmounts = { hours: number | null; regularHours: number | null; overtimeHours: number | null; jobs: number | null; revenue: number | null; labor: number | null; tips: number | null; bonuses: number | null; supplemental: number | null; totalPay: number | null };
export type DesktopCrewMember = CrewAmounts & { id: string; name: string; initials: string; role: string; truck: string; working: boolean; clockIn: string; clockOut: string; hourlyRate: number | null; status: string; issue: string; version: string; actionVersions?: { correction: string; bonus: string }; correction: { clockIn: string; clockOut: string; hourlyRate: number; note: string; updatedBy: string; updatedAt: string } | null; days: Array<CrewAmounts & { date: string; clockIn: string; clockOut: string }> };
export type CallInDecision = { name: string; targetDate: string; status: 'Recommended' | 'Called' | 'Confirmed' | 'Unavailable'; note: string; actor: string; updatedAt: string };
export type DesktopKreweSnapshot = { date: string; view: KreweView; start: string; end: string; sourceUpdatedAt: string | null; missingDates: string[]; payrollVisible: boolean; canWrite: boolean; members: DesktopCrewMember[]; totals: CrewAmounts; callIn: null | { targetDate: string; scheduleAvailable: boolean; appointmentCount: number; requiredCrews: number; requiredHeadcount: number; alreadyAssignedHeadcount: number; callInCount: number; assumedShiftHours: number; note: string; territoryDemand: Array<{ territory: string; appointments: number; crews: number }>; recommendations: Array<{ name: string; rank: number; suggestedRole: string; weeklyHours: number; projectedWeeklyHours: number; recentRph: number; recentJobs: number; overtimeRisk: boolean; reason: string; decision: CallInDecision | null; version: string }> } };
export type DesktopLocalReceipt = { requestId: string; action: string; entity: string; actor: string; fingerprint: string; status: 'pending' | 'verified' | 'uncertain' | 'failed'; updatedAt: string; input: Record<string, unknown>; expectedVersion: string };
export type FleetIssueRow = { issueId: string; truck: string; title: string; description: string; severity: string; status: string; owner: string; dueDate: string; resolution: string; cost: number | null; downtimeHours: number | null; updatedAt: string; version: string };
export type FleetMaintenanceRow = { recordId: string; truck: string; serviceDate: string; status: string; serviceType: string; description: string; odometer: number | null; cost: number | null; vendor: string; nextServiceDate: string; nextServiceOdometer: number | null; notes: string; version: string };
export type DesktopChecklist = { version: string; inspector: string; definitions: Array<{ itemId: string; label: string; guidance: string }>; answers: Array<{ itemId: string; status: string; notes: string }> };
export type DesktopFleetTruck = { id: string; label: string; vehicle: string; readiness: string; operatingStatus: string; driver: string; navigator: string; assignment: string; location: string; gpsAt: string | null; gpsFreshness: string; odometer: string; serviceStatus: string; nextService: string; checklist: string; loadPercent: number | null; loadNote: string; loadVersion: string; checklistVersion: string; checklists: Record<'daily' | 'weekly' | 'monthly', DesktopChecklist>; checklistDefinitions: Array<{ itemId: string; label: string; guidance: string }>; answers: Array<{ itemId: string; status: string; notes: string }>; jobs: number | null; revenue: number | null; miles: number | null; idleMinutes: number | null; driverScore: number | null };
export type DesktopFleetSnapshot = { date: string; report: string; sourceUpdatedAt: string | null; sourceAvailable: boolean; canWrite: boolean; trucks: DesktopFleetTruck[]; issues: FleetIssueRow[]; maintenance: FleetMaintenanceRow[]; reportRows: Array<{ truck: string; jobsCompleted: number; revenue: number; miles: number; idleTimeMinutes: number; averageDriverScore: number | null }>; reportCoverageDays: number; warnings: string[] };
export function validDesktopDate(value: string): boolean { return /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(`${value}T12:00:00Z`)) && new Date(`${value}T12:00:00Z`).toISOString().slice(0, 10) === value; }
export function nullableNumber(row: Record<string, unknown>, keys: string[]): number | null { for (const key of keys) { const value = row[key]; if (value !== null && value !== undefined && value !== '' && Number.isFinite(Number(value))) return Number(value); } return null; }
export function sumObserved(values: Array<number | null>): number | null { return values.length && values.every(value => value !== null) ? values.reduce<number>((sum, value) => sum + (value ?? 0), 0) : null; }

/** URL values are navigation hints, never record authority. Reject oversized input. */
export function boundedRecordQuery(params: URLSearchParams, key: string, maximum = 200): string {
  const value = (params.get(key) || '').trim();
  return value.length <= maximum ? value : '';
}
export function normalizedMemberQuery(value: string): string {
  const raw = value.trim().toLocaleLowerCase().replace(/[.']/g, '').replace(/\s+/g, ' ');
  const parts = raw.split(',').map(part => part.trim()).filter(Boolean);
  return parts.length === 2 ? `${parts[1]} ${parts[0]}` : raw;
}
export function uniqueMemberMatch<T extends { id: string; name: string }>(members: T[], query: string): T | null {
  if (!query || query.length > 200) return null;
  const key = normalizedMemberQuery(query);
  const matches = members.filter(member => normalizedMemberQuery(member.name) === key || normalizedMemberQuery(member.id) === key);
  return matches.length === 1 ? matches[0] : null;
}
export function normalizedTruckQuery(value: string): string | null {
  const match = value.trim().match(/^(?:Truck\s*#?\s*)?([1-9]\d{0,3})$/i);
  return match ? String(Number(match[1])) : null;
}
export function uniqueTruckMatch<T extends { id: string; label: string }>(trucks: T[], query: string): T | null {
  const key = normalizedTruckQuery(query);
  if (!key) return null;
  const matches = trucks.filter(truck => normalizedTruckQuery(truck.id) === key || normalizedTruckQuery(truck.label) === key);
  return matches.length === 1 ? matches[0] : null;
}

/** Re-evaluate point age even when the last server snapshot is retained after a failure. */
export function displayedGpsFreshness(timestamp: string | null, selectedDate: string, now: number): string {
  if (!timestamp || !Number.isFinite(Date.parse(timestamp))) return 'GPS unavailable';
  if (selectedDate !== new Intl.DateTimeFormat('en-CA',{timeZone:'America/Chicago'}).format(now)) return 'Historical GPS';
  const age=(now-Date.parse(timestamp))/60000;
  if(age<0)return 'GPS unavailable';
  if(age<=3)return 'Live GPS';
  if(age<=120)return 'GPS Stale';
  return 'Offline';
}
