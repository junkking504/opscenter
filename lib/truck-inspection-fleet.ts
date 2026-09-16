import { type TruckInspectionReport } from "./truck-inspection";
import { normalizeTruckLoadLabel, type TruckLoadEvent } from "./truck-load-status";

export function inspectionReportHref(report: TruckInspectionReport): string {
  return `/fleet-inspections?date=${report.inspectionDate}&report=${encodeURIComponent(`${report.deviceId}:${report.requestId}`)}`;
}

/** Project immutable inspection evidence; never overwrite the source or ledger. */
export function inspectionLoadEvents(reports: TruckInspectionReport[]): TruckLoadEvent[] {
  const fractions: Record<string, number> = { Empty: 0, "1/4": .25, "1/2": .5, "3/4": .75, Full: 1 };
  return reports.flatMap(report => {
    const fraction = report.loadLevel === undefined ? undefined : fractions[report.loadLevel];
    if (fraction === undefined || !Number.isFinite(Date.parse(report.startedAt))) return [];
    return [{ eventId: `inspection:${report.deviceId}:${report.requestId}`, date: report.inspectionDate,
      truck: normalizeTruckLoadLabel(report.truck), kind: "manual_snapshot", loadFraction: fraction,
      occurredAt: report.startedAt, recordedAt: report.receivedAt,
      recordedBy: `Five Point Inspection · ${report.inspector}`, appointmentId: "", jobNumber: "",
      loadSize: report.loadLevel!, loadQuantity: "", contents: "Contents not recorded", resetLocation: "",
    }];
  });
}

export function inspectionFleetEvidence(reports: TruckInspectionReport[], truck: string) {
  const matching = reports.filter(r => normalizeTruckLoadLabel(r.truck) === normalizeTruckLoadLabel(truck))
    .sort((a, b) => b.startedAt.localeCompare(a.startedAt) || b.receivedAt.localeCompare(a.receivedAt));
  // A later clear report does not prove that an earlier defect was repaired.
  const stop = matching.find(r => r.status === "stop");
  const problem = matching.find(r => r.status === "reported" || r.answers.some(a => a.status === "problem" || a.notes));
  const report = stop || problem || matching[0];
  return report ? { report, stop: Boolean(stop), problem: Boolean(problem),
    label: stop ? "Do not operate" : problem ? "Problem reported" : "Complete",
    source: `Five Point Inspection · ${report.inspector}`, href: inspectionReportHref(report),
  } : null;
}
