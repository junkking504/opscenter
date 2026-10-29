/** Individual source deletion, separate from removing a local payroll correction.
 * The adapter MUST provide a stable native entry ID. Positional WebForms IDs,
 * names and clock-value hashes are not acceptable source identities.
 * No production adapter is registered until that source contract is verified.
 */
export type SourceTimecard = {
  entryId: string; employeeId: string; marketId: string;
  workDate: string; clockIn: string; clockOut: string; clockOutDate: string;
  hourlyRate: number; version: string;
};
export type TimecardDeletion = {
  id: string; actor: string; employeeName: string;
  state: 'preview' | 'submitted' | 'verified' | 'failed' | 'uncertain';
  createdAt: string; expiresAt: string; updatedAt: string;
  before: SourceTimecard; siblings: SourceTimecard[];
  submittedAt?: string; verifiedAt?: string; message: string;
};
export type TimecardDeletionAdapter = {
  /** Full selected-day coverage for this exact employee/franchise, or throw. */
  read: () => Promise<SourceTimecard[]>;
  /** Recheck native employee/entry IDs and every editable value in the editor. */
  prepare: (expected: SourceTimecard) => Promise<void>;
  /** Exactly one native Delete submission, never retry internally. */
  submit: () => Promise<void>;
  /** Reload authoritative source, not a cached OpsCenter payroll snapshot. */
  reload: () => Promise<void>;
};
export type TimecardDeletionJournal = {
  /** Must durably persist before returning; caller holds the employee writer lock. */
  write: (receipt: TimecardDeletion) => void;
};
const identity = (entry: SourceTimecard) => `${entry.marketId}:${entry.employeeId}:${entry.entryId}`;
const snapshot = (entry: SourceTimecard) => JSON.stringify([
  identity(entry), entry.workDate, entry.clockIn, entry.clockOut,
  entry.clockOutDate, entry.hourlyRate, entry.version,
]);
function validDate(value: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value)) &&
    new Date(`${value}T12:00:00Z`).toISOString().slice(0, 10) === value;
}
export function validateTimecardCoverage(entries: SourceTimecard[], expected: SourceTimecard) {
  if (!expected.entryId || !expected.employeeId || !expected.marketId || !expected.version || !validDate(expected.workDate))
    throw new Error('A stable JunkWare entry identity and source version are required.');
  const seen = new Set<string>();
  for (const entry of entries) {
    if (!entry.entryId || !entry.version || entry.employeeId !== expected.employeeId ||
      entry.marketId !== expected.marketId || entry.workDate !== expected.workDate ||
      !Number.isFinite(entry.hourlyRate) || entry.hourlyRate < 0 ||
      (entry.clockOutDate && !validDate(entry.clockOutDate)))
      throw new Error('JunkWare entry coverage or identity could not be verified.');
    if (seen.has(identity(entry))) throw new Error('JunkWare returned an ambiguous entry identity.');
    seen.add(identity(entry));
  }
}
function sameEntries(actual: SourceTimecard[], expected: SourceTimecard[]) {
  return JSON.stringify(actual.map(snapshot).sort()) === JSON.stringify(expected.map(snapshot).sort());
}
export function previewTimecardDeletion(input: {
  id: string; actor: string; employeeName: string; selected: SourceTimecard;
  entries: SourceTimecard[]; now: string;
}): TimecardDeletion {
  if (!/^[a-f0-9-]{36}$/i.test(input.id) || !input.actor || !input.employeeName || !Number.isFinite(Date.parse(input.now)))
    throw new Error('A valid deletion request and manager identity are required.');
  validateTimecardCoverage(input.entries, input.selected);
  const selected = input.entries.find(entry => identity(entry) === identity(input.selected));
  if (!selected || snapshot(selected) !== snapshot(input.selected)) throw new Error('This entry changed. Reload before deleting.');
  return {
    id: input.id, actor: input.actor, employeeName: input.employeeName,
    state: 'preview', createdAt: input.now, updatedAt: input.now,
    expiresAt: new Date(Date.parse(input.now) + 5 * 60_000).toISOString(),
    before: structuredClone(selected), siblings: structuredClone(input.entries.filter(entry => entry !== selected)),
    message: 'Review the exact entry before deleting it from JunkWare. Deletion may be permanent.',
  };
}
/** Must run under the same employee lock as payroll corrections. Input is loaded
 * from the durable journal, never reconstructed from client-supplied before data.
 * Explicit confirmation applies only to an unexpired preview. All resumed
 * submissions and saved-result checks are read-only, even after process restart.
 */
export async function executeTimecardDeletion(
  initial: TimecardDeletion,
  input: { actor: string; confirm: boolean; now: () => string },
  adapter: TimecardDeletionAdapter,
  journal: TimecardDeletionJournal,
): Promise<TimecardDeletion> {
  if (input.actor !== initial.actor) throw new Error('This deletion request belongs to another manager.');
  let row = structuredClone(initial);
  const update = (patch: Partial<TimecardDeletion>) => {
    const next = {...row, ...patch, updatedAt: input.now()};
    journal.write(next); row = next;
  };
  if (row.state === 'verified' || row.state === 'failed') return row;
  const readOnly = !input.confirm || Boolean(row.submittedAt);
  // Checking a preview must never turn a missing submission into a new write.
  if (!row.submittedAt && readOnly) return row;
  try {
    if (!row.submittedAt) {
      if (Date.parse(input.now()) >= Date.parse(row.expiresAt)) throw new Error('Confirmation expired. Reload the entry.');
      const current = await adapter.read();
      validateTimecardCoverage(current, row.before);
      if (!sameEntries(current, [row.before, ...row.siblings])) throw new Error('The source entries changed. Reload before deleting.');
      await adapter.prepare(row.before);
      if (Date.parse(input.now()) >= Date.parse(row.expiresAt)) throw new Error('Confirmation expired. Nothing was deleted.');
      update({state:'submitted', submittedAt:input.now(), message:'Deletion submitted. Verifying JunkWare.'});
      try { await adapter.submit(); } catch { /* Read source after an ambiguous transport result. */ }
    }
    await adapter.reload();
    const after = await adapter.read();
    validateTimecardCoverage(after, row.before);
    if (after.some(entry => identity(entry) === identity(row.before))) throw new Error('The entry is still present. No deletion was retried.');
    if (!sameEntries(after, row.siblings)) throw new Error('Other entries changed. The deletion result needs source review.');
    update({state:'verified', verifiedAt:input.now(), message:'Entry deleted in JunkWare. Saved payroll totals may still be awaiting synchronization.'});
  } catch (error) {
    update({state:row.submittedAt?'uncertain':'failed', message:error instanceof Error?error.message:'Deletion could not be verified.'});
  }
  return row;
}
