import type { SlackDigestMessage } from './slack-digest';

/** Delivery identity is separate from the event: a retry can have another Slack ID.
 * Never deduplicate by job alone (visits, photo batches and receipts can recur).
 * Keep the first ID for existing workflow actions, with the latest event facts.
 */
export function deduplicateOperationalUpdates(messages: SlackDigestMessage[]): SlackDigestMessage[] {
  const groups = new Map<string, SlackDigestMessage>();
  for (const message of [...messages].sort((a, b) => a.timestamp.localeCompare(b.timestamp) || a.id.localeCompare(b.id))) {
    const fingerprint = message.eventFingerprint || message.rawText.match(/Alert ID:\s*([^\s*]+?)(?:_?\s*$)/im)?.[1];
    // Legacy records without an event ID stay separate: identical prose can be
    // a real second visit or receipt. Recovery never replaces its opening event.
    const key = fingerprint && !message.threadReply ? `event:${fingerprint}` : `message:${message.id}`;
    const previous = groups.get(key);
    if (!previous) { groups.set(key, { ...message, sourceMessageIds: message.sourceMessageIds || [message.id] }); continue; }
    const sourceMessageIds = Array.from(new Set([...(previous.sourceMessageIds || [previous.id]), ...(message.sourceMessageIds || [message.id])]));
    const changed = previous.rawText !== message.rawText;
    const latest = Date.parse(message.updatedAt || message.timestamp) >= Date.parse(previous.updatedAt || previous.timestamp) ? message : previous;
    groups.set(key, {
      ...latest, id: previous.id, timestamp: previous.timestamp, sourceMessageIds,
      channel: /truck[- ]\d+/i.test(previous.channel) && !/truck[- ]\d+/i.test(latest.channel) ? previous.channel : latest.channel,
      updatedAt: latest.updatedAt || latest.timestamp,
      corrected: previous.corrected || message.corrected || changed,
    });
  }
  return [...groups.values()].sort((a, b) => b.timestamp.localeCompare(a.timestamp));
}
