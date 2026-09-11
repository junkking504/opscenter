// The browser and server share a closed vocabulary. No URL, ID, message or stack
// from a user session is persisted or sent to the model.
export const maintenanceOperations = {
  schedule: 'Schedule load', command: 'Command load', control: 'Control load',
  'schedule-closeout': 'Appointment closeout', 'schedule-creation': 'Appointment creation',
  'schedule-operations': 'Schedule change', 'schedule-routes': 'Schedule routing',
  'schedule-plan': 'Route plan', 'schedule-order': 'Stop order',
  fleet: 'Fleet', krewe: 'Krewe', finance: 'Finance', marketing: 'Marketing',
  javascript: 'Browser runtime',
} as const;
export type MaintenanceOperation = keyof typeof maintenanceOperations;
export type ClientEvidence = { category: MaintenanceOperation; failure?: 'http' | 'network' | 'timeout' | 'runtime' | 'invalid-response'; method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'; status?: number };
export type ClientEvent = ClientEvidence & { at: number; count: number };
export function validClientEvidence(value: unknown): value is ClientEvidence {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const row = value as Record<string, unknown>;
  return Object.keys(row).every(k => ['category','failure','method','status'].includes(k))
    && typeof row.category === 'string' && Object.hasOwn(maintenanceOperations, row.category)
    && (row.failure === undefined || ['http','network','timeout','runtime','invalid-response'].includes(String(row.failure)))
    && (row.method === undefined || ['GET','POST','PUT','PATCH','DELETE'].includes(String(row.method)))
    && (row.status === undefined || Number.isInteger(row.status) && Number(row.status) >= 400 && Number(row.status) <= 599);
}
export function maintenanceOperation(pathname: string): MaintenanceOperation | null {
  const match = pathname.match(/^\/api\/desktop\/(schedule|command|control|fleet|krewe|finance|marketing)(?:\/([^/]+))?(?:\/|$)/);
  if (!match) return null;
  const specific = `${match[1]}-${match[2]}`;
  return (Object.hasOwn(maintenanceOperations, specific) ? specific : match[1]) as MaintenanceOperation;
}
export function validReadSnapshot(operation: MaintenanceOperation, body: unknown): boolean {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return false;
  const row = body as Record<string, unknown>;
  if (operation === 'schedule') return typeof row.date === 'string' && Array.isArray(row.appointments) && row.appointments.every((item: unknown) => !!item && typeof item === 'object' && typeof (item as Record<string, unknown>).recordId === 'string') && new Set(row.appointments.map((item: { recordId: string }) => item.recordId)).size === row.appointments.length && !!row.fleet && Array.isArray((row.fleet as Record<string, unknown>).trucks);
  if (operation === 'command') return typeof row.date === 'string' && Array.isArray(row.alerts) && Array.isArray(row.kpis) && !!row.sources && typeof (row.sources as Record<string, unknown>).alerts === 'boolean';
  if (operation === 'fleet') return typeof row.date === 'string' && Array.isArray(row.trucks) && typeof row.sourceAvailable === 'boolean';
  return true;
}
