import { sameTruck } from './convoy-presentation';
import { mileageQuality } from '../../lib/fleet-service-plan';
import type { DesktopFleetSnapshot, DesktopFleetTruck, FleetMaintenanceRow, FleetIssueRow } from './people-fleet-contract';

export type HistoryEntry = { id: string; truck: string; date: string; title: string; description: string; status: string; kind: 'invoice' | 'service' | 'repair'; cost: number | null; categories: string[]; record?: FleetMaintenanceRow; issue?: FleetIssueRow; children: FleetMaintenanceRow[]; search: string };
export const linkedInvoiceId = (record: FleetMaintenanceRow) => record.notes.match(/Linked invoice record: ([^\s.]+)/)?.[1] || '';
export const invoiceNumber = (record: FleetMaintenanceRow) => record.description.match(/^Invoice\s+#([^\s—–]+)/i)?.[1] || '';
export const recordTitle = (record: FleetMaintenanceRow) => invoiceNumber(record) ? `Invoice #${invoiceNumber(record)}` : record.serviceType;

/** Only explicit, same-truck invoice links collapse rows. Unmatched records remain visible. */
export function historyEntries(snapshot: Pick<DesktopFleetSnapshot, 'maintenance' | 'issues'>): HistoryEntry[] {
  const parents = new Map(snapshot.maintenance.filter(r => r.recordId.startsWith('invoice-') && invoiceNumber(r)).map(r => [r.recordId, r]));
  const children = new Map<string, FleetMaintenanceRow[]>();
  const grouped = new Set<string>();
  for (const r of snapshot.maintenance) {
    const parent = parents.get(linkedInvoiceId(r));
    if (parent && parent.recordId !== r.recordId && sameTruck(parent.truck, r.truck) && parent.status === r.status && parent.serviceDate === r.serviceDate) {
      children.set(parent.recordId, [...(children.get(parent.recordId) || []), r]); grouped.add(r.recordId);
    }
  }
  const service: HistoryEntry[] = snapshot.maintenance.filter(r => !grouped.has(r.recordId)).map(r => {
    const related = children.get(r.recordId) || [];
    const categories = [...new Set((related.length ? related : [r]).map(item => item.serviceType))];
    return { id: `service:${r.recordId}`, truck: r.truck, date: r.serviceDate, title: recordTitle(r), description: r.description, status: r.status, kind: parents.has(r.recordId) ? 'invoice' : 'service', cost: r.cost, categories, record: r, children: related,
      search: [r.truck, r.description, r.serviceType, r.vendor, r.notes, ...related.flatMap(c => [c.description, c.serviceType, c.notes])].join(' ').toLowerCase() };
  });
  const repairs: HistoryEntry[] = snapshot.issues.map(r => ({ id:`repair:${r.issueId}`, truck:r.truck, date:r.updatedAt.slice(0,10), title:r.title, description:r.description, status:r.status, kind:'repair', cost:r.cost, categories:['Repair'], issue:r, children:[], search:[r.truck,r.title,r.description,r.resolution,r.owner].join(' ').toLowerCase() }));
  return [...service,...repairs].sort((a,b) => b.date.localeCompare(a.date) || a.truck.localeCompare(b.truck,undefined,{numeric:true}) || a.id.localeCompare(b.id));
}
export function filterHistory(entries: HistoryEntry[], filters: { truck?: string; query?: string; kind?: string; from?: string; to?: string; category?: string }) {
  const words = (filters.query || '').toLowerCase().trim().split(/\s+/).filter(Boolean);
  return entries.filter(row => (!filters.truck || sameTruck(row.truck,filters.truck)) && words.every(word=>row.search.includes(word)) && (!filters.from || row.date >= filters.from) && (!filters.to || row.date <= filters.to) && (!filters.category || row.categories.includes(filters.category)) && (!filters.kind || (filters.kind === 'completed' ? row.kind !== 'repair' && row.status === 'completed' : filters.kind === 'scheduled' ? row.status === 'scheduled' : row.kind === filters.kind)));
}
/** Count bill totals once; unallocated invoice categories are not missing bills. */
export function historyCosts(entries: HistoryEntry[]) {
  const completed = entries.filter(r => r.status === 'completed' || r.status === 'resolved');
  const known = completed.filter(r => r.cost !== null);
  return { total: known.length ? known.reduce((sum,r)=>sum+(r.cost??0),0) : null, missing: completed.length-known.length, count: completed.length };
}
export function truckMileageReview(truck: DesktopFleetTruck, records: FleetMaintenanceRow[], now: number) {
  const latest = records.filter(r => sameTruck(r.truck,truck.id) && r.status==='completed' && r.odometer!==null && Date.parse(`${r.serviceDate}T12:00:00Z`) <= now).sort((a,b)=>b.serviceDate.localeCompare(a.serviceDate))[0];
  const belowService = truck.mileage?.value != null && latest?.odometer != null && truck.mileage.value < latest.odometer;
  return { quality: belowService ? 'conflict' as const : mileageQuality(truck.mileage, now), belowService, latest };
}

/** Display-only grouping; retain every line and amount from the recorded description. */
export function workSections(description: string) {
  const sections: Array<{ label: string; text: string }> = [];
  for (const line of description.split('\n').map(line => line.trim()).filter(Boolean)) {
    if (/^Invoice\s+#\S+\s+[—–-]\s+completed service and repairs$/i.test(line)) continue;
    const match = line.match(/^([A-Za-z][A-Za-z /&-]{1,30}):\s*(.*)$/);
    if (match) sections.push({label:match[1],text:match[2]});
    else if (sections.length) sections[sections.length-1].text += `\n${line}`;
    else sections.push({label:'Work details',text:line});
  }
  return sections;
}
export function visitTitle(row: HistoryEntry) {
  if (row.kind !== 'invoice') return row.title;
  const categories = row.categories.filter(c => c !== 'Other');
  return categories.length ? categories.slice(0,3).join(' · ') + (categories.length>3?` +${categories.length-3}`:'') : 'Service visit';
}
