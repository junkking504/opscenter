export type ControlItem = {
  id: string; version: number; operatingDate: string; category: 'Jobs' | 'Crew' | 'Fleet' | 'Finance';
  severity: 'critical' | 'warning' | 'info'; title: string; description: string; source: string;
  sourceObservedAt: string; status: 'open' | 'acknowledged' | 'in_progress' | 'snoozed' | 'resolved' | 'dismissed';
  entity: { type: string; id: string; label?: string }; ownerActorId?: string; ownerDisplayName?: string;
  dueAt?: string; resolutionCode?: string; resolutionNote?: string; href?: string; recommendedAction: string;
  overdue: boolean; carryover: boolean;
};
export type ControlGate = {
  id: string; title: string; count: number | null; unit: string; detail: string; source: string;
  href: string; category: ControlItem['category']; evidenceVersion: string; ownedBy?: string; workItemId?: string; workItemPage?: number;
};
export type ControlAudit = { id: string; at: string; action: string; actor: string; record: string; before: string; after: string; reason: string };
export type ControlSnapshot = {
  date: string; generatedAt: string; actor: { id: string; displayName: string; canWrite: boolean; canCloseDay: boolean };
  items: ControlItem[]; itemLimit: number; itemsTruncated: boolean; scheduleAvailable: boolean;
  pagination: { page: number; pageSize: number; total: number; pages: number };
  actionRuns: Array<{ id: string; key: string; status: string; workspace: string; href: string; requestedAt: string }>;
  gates: { start: ControlGate[]; close: ControlGate[] };
  day: { status: 'planning' | 'operating' | 'closed'; version: number; updatedAt: string | null };
  closeouts: Array<{ id: string; appointmentId: string; jk: string; customer: string; truck: string; window: string; category: string; amount: number | null; detail: string; href: string }>;
  routes: Array<{ truck: string; crew: string; status: string; stops: number; complete: number; next: string; freshness: string }>;
  sources: Array<{ name: string; state: string; tone: 'healthy' | 'warning' | 'critical'; detail: string; observedAt: string | null }>;
  audit: ControlAudit[];
  counts: { approval: number; verifying: number; verified: number };
};
export type ControlAction = 'handoff' | 'acknowledge' | 'resolve_manually' | 'dismiss' | 'reopen' | 'own_gate' | 'start_day' | 'close_day' | 'reopen_day';
export type ControlRequest = {
  date: string; requestId: string; action: ControlAction; expectedVersion: number;
  itemId?: string; gateId?: string; evidenceVersion?: string; reason?: string; dueAt?: string;
  status?: 'open' | 'acknowledged' | 'in_progress' | 'snoozed'; assignToSelf?: boolean;
};

export function validControlDate(value: unknown): string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error('A valid operating date is required.');
  const parsed = new Date(value + 'T12:00:00Z');
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) throw new Error('A valid operating date is required.');
  return value;
}
export function controlGateCleared(gate: ControlGate): boolean { return gate.count === 0 || Boolean(gate.ownedBy && gate.workItemId); }
export function controlItemActive(item: Pick<ControlItem, 'status'>): boolean { return !['resolved', 'dismissed'].includes(item.status); }
// PostgreSQL JSONB may reorder keys. Receipt comparison must not depend on the
// browser's object insertion order or the database's serialized key order.
export function canonicalControlInput(value: unknown): string {
  const normalize = (input: unknown): unknown => Array.isArray(input) ? input.map(normalize) : input && typeof input === 'object' ? Object.fromEntries(Object.entries(input).filter(([, value]) => value !== undefined).sort(([a], [b]) => a.localeCompare(b)).map(([key, value]) => [key, normalize(value)])) : input;
  return JSON.stringify(normalize(value));
}
export function controlStatus(status: string): string { return ({ open: 'Open', acknowledged: 'Acknowledged', in_progress: 'In Progress', snoozed: 'Waiting', resolved: 'Resolved', dismissed: 'Dismissed' } as Record<string, string>)[status] || status; }
export function parseControlRequest(value: unknown, now = new Date()): ControlRequest {
  if (!value || typeof value !== 'object') throw new Error('Action details are required.');
  const body = value as Record<string, unknown>;
  const actions: ControlAction[] = ['handoff', 'acknowledge', 'resolve_manually', 'dismiss', 'reopen', 'own_gate', 'start_day', 'close_day', 'reopen_day'];
  if (!actions.includes(body.action as ControlAction)) throw new Error('Unsupported Control action.');
  if (typeof body.requestId !== 'string' || !/^[a-zA-Z0-9_-]{12,100}$/.test(body.requestId)) throw new Error('A valid request ID is required.');
  if (!Number.isInteger(body.expectedVersion) || Number(body.expectedVersion) < 0) throw new Error('A valid expected version is required.');
  const action = body.action as ControlAction;
  const reason = String(body.reason || '').trim();
  if (reason.length > 1000 || (['own_gate', 'handoff', 'resolve_manually', 'dismiss', 'reopen_day'].includes(action) && reason.length < 8)) throw new Error('A reason of 8 to 1000 characters is required.');
  const itemId = body.itemId === undefined ? undefined : String(body.itemId);
  if (['handoff', 'acknowledge', 'resolve_manually', 'dismiss', 'reopen'].includes(action) && (!itemId || itemId.length > 120 || Number(body.expectedVersion) < 1)) throw new Error('A work item and version are required.');
  const status = body.status as ControlRequest['status'];
  if (action === 'handoff' && !['open', 'acknowledged', 'in_progress', 'snoozed'].includes(status || '')) throw new Error('A valid working status is required.');
  let dueAt: string | undefined;
  if (body.dueAt) {
    const parsed = new Date(String(body.dueAt));
    if (!Number.isFinite(parsed.getTime()) || parsed <= now || parsed.getTime() > now.getTime() + 31 * 86400000) throw new Error('A future deadline within 31 days is required.');
    dueAt = parsed.toISOString();
  }
  if ((action === 'own_gate' || action === 'handoff') && !dueAt) throw new Error('A future deadline is required.');
  if (action === 'own_gate' && (!/^((start|close):)[a-z_]+$/.test(String(body.gateId || '')) || !/^[a-f0-9]{64}$/.test(String(body.evidenceVersion || '')))) throw new Error('Current gate evidence is required.');
  return { date: validControlDate(body.date), requestId: body.requestId, action, expectedVersion: Number(body.expectedVersion), itemId, gateId: body.gateId ? String(body.gateId) : undefined, evidenceVersion: body.evidenceVersion ? String(body.evidenceVersion) : undefined, reason, dueAt, status, assignToSelf: body.assignToSelf === true };
}
