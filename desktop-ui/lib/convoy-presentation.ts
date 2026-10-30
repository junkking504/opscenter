import { normalizedTruckQuery, type DesktopFleetTruck, type FleetIssueRow, type FleetView } from './people-fleet-contract';

export const convoyTabs = [
  ['overview', 'Overview'], ['inspections', 'Inspections'], ['maintenance', 'Repairs'], ['service', 'Maintenance'], ['reports', 'Records'], ['scores', 'Driving'],
] as const satisfies ReadonlyArray<readonly [FleetView, string]>;

export function sameTruck(left: string, right: string) {
  const key = normalizedTruckQuery(left);
  return key !== null && key === normalizedTruckQuery(right);
}

export function truckCondition(truck: DesktopFleetTruck) {
  if (truck.readiness !== 'Attention') return truck.readiness;
  return truck.checklist === 'Missing' ? 'Inspection missing' : 'Repair needed';
}

export function truckLoadLabel(truck: DesktopFleetTruck) {
  if (truck.loadNeedsVerification || /provisional|verify/i.test(truck.loadLabel || '')) return 'Load needs confirmation';
  return truck.loadLabel || (truck.loadPercent === null ? 'Load not recorded' : `${truck.loadPercent}% full`);
}

export function duplicateRepair(issue: FleetIssueRow, issues: FleetIssueRow[]) {
  return issues.some(other => other.issueId !== issue.issueId && sameTruck(other.truck, issue.truck)
    && other.status !== 'resolved' && issue.status !== 'resolved'
    && other.title.trim().toLowerCase() === issue.title.trim().toLowerCase()
    && other.description.trim().toLowerCase() === issue.description.trim().toLowerCase());
}

/** Load warnings belong with the truck's load, not above every unrelated tab. */
export function convoyWarnings(warnings: string[], view: FleetView, truck = '') {
  return warnings.filter(warning => {
    const load = /^Truck\s*#?\s*\d+: load/i.test(warning);
    if (load && view !== 'overview') return false;
    if (load && truck) return sameTruck(warning.split(':')[0], truck);
    return true;
  });
}

export const recordedValue = (value: string | undefined, fallback = 'Not recorded') => !value || /^(—|Unavailable|No source target)( · —)?$/i.test(value) ? fallback : value;

/** Preserve old Repairs links; the archive flag has always selected inspection reports. */
export function initialFleetView(search: string): FleetView {
  const params = new URLSearchParams(search);
  if (params.get('inspectionReports') === '1') return 'inspections';
  const view = params.get('fleetView');
  return convoyTabs.find(([key]) => key === view)?.[0] || 'overview';
}

export const fleetPagePurpose: Record<FleetView, string> = {
  overview: 'Check truck availability and items needing attention. Follows the selected day.',
  inspections: 'Review Five Point Inspections and findings. Follows the selected day.',
  maintenance: 'Track open repairs and their progress. Shows all dates.',
  service: 'Plan upcoming service and maintenance. Follows the selected day.',
  reports: 'Find recorded repairs, service and invoices. Shows all dates.',
  scores: 'Review driving scores and events. Follows the selected day.',
};
