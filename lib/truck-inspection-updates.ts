import fs from 'node:fs';
import path from 'node:path';
import { inspectionDate, type TruckInspectionReport } from './truck-inspection';
import { listTruckInspections } from './truck-inspection-store';
import { inspectionSlackNotification } from './truck-inspection-notifications';
import type { OperationalAlert } from './operational-alert-presentation';

export function inspectionTimelineAlert(report: TruckInspectionReport): OperationalAlert {
  // Reuse the receipt identity and full reported facts used by the publisher.
  // This formatter performs no delivery and does not depend on Slack access.
  const receipt = inspectionSlackNotification(report);
  const needsAction = report.status !== 'clear' || Boolean(report.notes.trim())
    || report.answers.some(answer => answer.status === 'problem' || answer.notes.trim());
  return {
    id: receipt.fingerprint, eventFingerprint: receipt.fingerprint,
    source: 'OpsCenter inspections', label: 'Inspection Submitted',
    domain: 'Fleet', owner: 'Fleet', truck: report.truck,
    title: report.inspector, timestamp: report.receivedAt,
    detected: new Intl.DateTimeFormat('en-US', { timeZone: 'America/Chicago', hour: 'numeric', minute: '2-digit' }).format(new Date(report.receivedAt)),
    needsAction, facts: (receipt.fields || []).map(field => ({ label: field.label, value: String(field.value ?? '') })),
    next: report.status === 'stop' ? 'Do not operate. Supervisor review required.'
      : needsAction ? 'Review the reported findings and notes. Submission is not supervisor clearance.'
        : 'Inspection received. No problems reported; submission is not supervisor clearance.',
    href: `/fleet-inspections?date=${report.inspectionDate}&report=${encodeURIComponent(`${report.deviceId}:${report.requestId}`)}`,
  };
}

/** Receipt-day history, including drafts started up to seven days earlier. */
export function readInspectionTimeline(date: string, read = listTruckInspections): { alerts: OperationalAlert[]; complete: boolean } {
  const alerts: OperationalAlert[] = [];
  let complete = true;
  for (let offset = 0; offset <= 7; offset++) {
    const day = new Date(`${date}T12:00:00Z`);
    day.setUTCDate(day.getUTCDate() - offset);
    try {
      for (const report of read(day.toISOString().slice(0, 10))) {
        if (inspectionDate(new Date(report.receivedAt)) === date) alerts.push(inspectionTimelineAlert(report));
      }
    } catch { complete = false; }
  }
  // Existing Slack-owned follow-ups must still match when channel history is
  // unavailable. A missing/corrupt optional delivery ledger never hides reports.
  try {
    const file = process.env.SLACK_OPSCENTER_STATE_FILE || path.join(process.cwd(), 'data', 'slack', 'ops_alert_state.json');
    const receipts = JSON.parse(fs.readFileSync(file, 'utf8')).notificationMessages;
    for (const alert of alerts) {
      const receipt = receipts?.[alert.id];
      if (/^C[A-Z0-9]+$/.test(receipt?.channelId || '') && /^\d+\.\d+$/.test(receipt?.ts || '')) {
        alert.sourceMessageIds = [`${receipt.channelId}:${receipt.ts}`];
      }
    }
  } catch { /* Optional aliases; native identity remains stable. */ }
  return { alerts: alerts.sort((a, b) => b.timestamp!.localeCompare(a.timestamp!)), complete };
}

/** Replace exact Slack copies with authoritative reports, retaining review IDs. */
export function mergeInspectionTimeline(alerts: OperationalAlert[], inspections: OperationalAlert[]): OperationalAlert[] {
  const matches = (alert: OperationalAlert, inspection: OperationalAlert) =>
    alert.id === inspection.id || alert.eventFingerprint === inspection.eventFingerprint
    || Boolean(inspection.sourceMessageIds?.includes(alert.id));
  return [
    ...alerts.filter(alert => !inspections.some(inspection => matches(alert, inspection))),
    ...inspections.map(inspection => ({ ...inspection, sourceMessageIds: [...new Set([
      ...(inspection.sourceMessageIds || []),
      ...alerts.filter(alert => matches(alert, inspection)).flatMap(alert => [alert.id, ...(alert.sourceMessageIds || [])]),
    ])] })),
  ];
}
