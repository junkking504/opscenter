import { mutateResaleStore, readResaleStore } from './resale-items';
import { commercialVersion, CommercialActionError } from './desktop-marketing';
import { opsRoleCan, type InteractiveOpsRole } from './ops-roles';
import type { CommercialOperation, CommercialReceipt } from '../desktop-ui/lib/commercial-contract';

/** Item state and its attributable receipt commit in the same locked snapshot. */
export function changeResaleLifecycle(operation: CommercialOperation, actor: { email: string; role: InteractiveOpsRole }): CommercialReceipt {
  if (!opsRoleCan(actor.role, 'sensitive.write')) throw new CommercialActionError('Manager permission is required.');
  if (!['resale.delete', 'resale.restore'].includes(operation.action)) throw new CommercialActionError('Unsupported inventory action.');
  const fingerprint = commercialVersion(operation);
  mutateResaleStore(store => {
    store.lifecycleReceipts ||= {};
    const previous = store.lifecycleReceipts[operation.requestId];
    if (previous) {
      if (previous.actor !== actor.email || previous.fingerprint !== fingerprint) throw new CommercialActionError('Request ID belongs to another change.');
      return;
    }
    const item = store.items.find(item => item.itemId === operation.recordId);
    if (!item || commercialVersion(item) !== operation.expectedVersion) throw new CommercialActionError('The item changed. Close this confirmation, refresh and review it again.');
    const deleting = operation.action === 'resale.delete';
    if (Boolean(item.deletedAt) === deleting) throw new CommercialActionError(deleting ? 'This item is already deleted.' : 'This item is already active.');
    const now = new Date().toISOString();
    if (deleting) { item.deletedAt = now; item.deletedBy = actor.email; }
    else { delete item.deletedAt; delete item.deletedBy; }
    item.updatedAt = now;
    store.lifecycleReceipts[operation.requestId] = {
      requestId: operation.requestId, recordId: item.itemId, action: operation.action,
      actor: actor.email, fingerprint, expectedVersion: operation.expectedVersion,
      input: { itemNumber: item.itemNumber, itemName: item.itemName },
      permission: 'sensitive.write', authority: 'opscenter_authoritative',
      status: 'verified', updatedAt: now,
      message: deleting ? 'Item moved to Deleted. Photos and financial evidence retained.' : 'Item restored with its original photos and evidence.',
    };
  }, false);
  const receipt = readResaleStore(true).lifecycleReceipts?.[operation.requestId];
  if (!receipt || receipt.fingerprint !== fingerprint || receipt.actor !== actor.email) throw new CommercialActionError('The saved result could not be confirmed. Retry the same request.', 'uncertain');
  return receipt;
}
