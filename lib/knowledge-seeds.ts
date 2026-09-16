import type { KnowledgeEntry, KnowledgeDraft } from '../desktop-ui/lib/knowledge-contract';

// These are documentation-backed guidance, never observations of live records.
const revision = 'abf6f129d362a8d99b3a07438819dd19227f2a40';
function guide(id: string, draft: Omit<KnowledgeDraft, 'sourceUrl' | 'owner' | 'sourceNote'>, file: string, excerpt: string): KnowledgeEntry {
  return { ...draft, id: `guide-${id}`, version: 1, status: 'documented', owner: 'Mission Control',
    sourceUrl: `https://github.com/junkking504/opscenter/blob/${revision}/${file}`,
    sourceNote: 'Reviewed against the linked OpsCenter documentation on September 16, 2026. Check the current source before taking action.',
    sourceExcerpt: excerpt, updatedAt: '2026-09-16T15:00:00.000Z', updatedBy: 'OpsCenter documentation',
    verifiedAt: null, verifiedBy: null, verificationNote: '', reviewDue: '2026-10-16T15:00:00.000Z', history: [] };
}
export const knowledgeSeeds: KnowledgeEntry[] = [
  guide('closeout', { title: 'Recover a closeout with an uncertain result', kind: 'procedure', workspace: 'Schedule',
    summary: 'Check the saved JunkWare result before attempting another closeout.', sourceLabel: 'JunkWare write-through · Schedule closeout reliability',
    body: '1. Open the appointment in Control and inspect its closeout receipt.\n2. If it is pending or uncertain, use Check Saved Result. Keep the draft while verification is pending.\n3. Compare the saved JunkWare category, status, charges and payment reference with the intended result.\n4. Confirm the appointment display reflects the saved source. A local receipt or closed dialog alone does not establish success.\n5. If the result remains uncertain, preserve the evidence and escalate for source review; do not submit another payment or closeout blindly.' },
    'docs/junkware-write-through.md', 'Pending or uncertain receipts expose **Check Saved\nResult** instead of another submission.'),
  guide('held-photos', { title: 'Find and review missing job photos', kind: 'procedure', workspace: 'Schedule',
    summary: 'Trace a held photo to its source and intended appointment before recovery.', sourceLabel: 'WhatsApp job photos · Reviewing held photos',
    body: '1. Open Command → Source Health and choose Review photo decisions. A manager or administrator can inspect the queue.\n2. Search by JK reference, received date or caption and inspect the reason and available cached preview.\n3. Check the intended appointment and existing media in JunkWare. A JK reference on the received date is not a verified appointment match.\n4. Missing sender mappings, stale GPS and ambiguous matches require review. Opening the queue does not retry or release a photo.\n5. Record the confirmed cause and recovery evidence. Request a separately authorized recovery when needed; an absent preview does not prove an upload failed.' },
    'docs/whatsapp-job-photos.md', 'There are no mutation handlers: opening the panel does not alter mappings,\nretry an upload, release a hold, or delete a record.'),
  guide('finance-sources', { title: 'Keep financial metrics tied to their own sources', kind: 'decision', workspace: 'Finance',
    summary: 'A failure in one feed must not turn unrelated available revenue into zero.', sourceLabel: 'Approved Desktop Source Release · Daily finance freshness',
    body: 'Decision: assess revenue, payroll, costs and net using their own source evidence and timestamps.\n\nReason: a shared refresh timestamp or unrelated GPS failure cannot establish whether a financial value is current.\n\nWhen investigating a number, inspect the metric source time and status. Preserve the last recorded amount as historical context when current data is unavailable. Net and aggregate costs also depend on their component inputs. A genuine fresh zero remains zero.\n\nPayment processor approval, JunkWare operational records and QBO accounting remain separate evidence. This guide contains no current balances or payment confirmations.' },
    'docs/prototype-source-release.md', 'Revenue depends on its own source. Payroll, disposal/fuel, costs, and net keep\nseparate evidence; aggregate costs/net also require their component inputs.'),
  guide('closeout-postback', { title: 'Closeout dropdown changes missed partial page updates', kind: 'incident', workspace: 'Schedule',
    summary: 'Documented resolution: await the matching WebForms update and verify the saved values.', sourceLabel: 'JunkWare write-through · Closeout dropdown recovery',
    body: 'Symptom: a closeout dropdown change could miss the partial Other Charge update when the integration forced a form submission and waited only for navigation.\n\nDocumented resolution: dispatch native change handlers and await the matching POST plus WebForms completion, including partial page updates.\n\nVerification for a recurrence: inspect the exact saved charges and status in JunkWare and read the result back into the appointment. A successful application release is separate from the current appointment outcome.\n\nRecovery: preserve an uncertain receipt and use Check Saved Result before another submission. This is a historical resolution, not a claim that all current closeouts are healthy.' },
    'docs/junkware-write-through.md', 'Closeout dropdowns dispatch their native change handlers and await the matching\nPOST plus WebForms completion, supporting both full and partial page updates.'),
  guide('source-authority', { title: 'Choose the right source before acting', kind: 'decision', workspace: 'All',
    summary: 'Use OpsCenter for operational decisions and the owning system for source facts.', sourceLabel: 'OpsCenter OS Constitution · Authority and verification',
    body: 'OpsCenter owns operational intent, work state, policy and action history. External systems retain authority over their records.\n\nCheck appointments in JunkWare, accounting in QBO, processor approval in the payment processor, and telemetry in LinxUp. Derived or provisional values need to be identified as such.\n\nA remembered procedure explains how to investigate. Its review date never makes a live customer record or financial amount current.\n\nBefore resolving work, verify the outcome against the correct source and record the evidence. If verification is delayed, retain a pending state.' },
    'docs/OPSCENTER_OS_CONSTITUTION.md', 'If verification is delayed, OpsCenter reports `verifying` (displayed as “Verification pending”), not success.'),
  guide('spending', { title: 'Approve a cost before enabling a metered feature', kind: 'decision', workspace: 'All',
    summary: 'Credentials and deployment permission do not authorize new usage charges.', sourceLabel: 'Spending controls · Current policy',
    body: 'Before enabling a new provider, feature, request volume or spending limit, obtain explicit approval for the provider, purpose and maximum spend.\n\nKeep the existing spending gate intact. Use mocked providers for tests. Free credits and budget alerts are not enforceable caps.\n\nRecord the approval and limit in the governing policy before enabling requests. The Second Brain itself uses local search and storage and makes no paid AI requests.' },
    'docs/spending-controls.md', 'Credentials authenticate requests; they do not authorize spending.'),
];
