"use client";

import type { FleetChecklistEntry } from "@/lib/fleet-checklists";
import type { FleetIssue } from "@/lib/fleet-issues";
import type { FleetMaintenanceRecord } from "@/lib/fleet-maintenance";

function money(value: number): string {
  return value.toLocaleString("en-US", { style: "currency", currency: "USD" });
}

function csvCell(value: unknown): string {
  return `"${String(value ?? "").replace(/"/g, '""')}"`;
}

export default function FleetReportsPanel({ entries, issues, records, today }: { entries: FleetChecklistEntry[]; issues: FleetIssue[]; records: FleetMaintenanceRecord[]; today: string }) {
  const cutoff = new Date(`${today}T12:00:00`);
  cutoff.setDate(cutoff.getDate() - 30);
  const cutoffKey = cutoff.toISOString().slice(0, 10);
  const recentEntries = entries.filter((entry) => entry.inspectionDate >= cutoffKey);
  const completed = recentEntries.filter((entry) => entry.completedAt);
  const activeIssues = issues.filter((issue) => issue.status !== "resolved");
  const maintenanceSpend = records.filter((record) => record.status === "completed" && record.serviceDate >= cutoffKey).reduce((sum, record) => sum + (record.cost || 0), 0);
  const downtime = issues.filter((issue) => (issue.resolvedAt || issue.updatedAt).slice(0, 10) >= cutoffKey).reduce((sum, issue) => sum + (issue.downtimeHours || 0), 0);
  const inspectors = Array.from(completed.reduce((map, entry) => {
    const row = map.get(entry.inspector) || { name: entry.inspector, completed: 0, attention: 0 };
    row.completed += 1;
    row.attention += entry.answers.filter((answer) => answer.status === "attention").length;
    map.set(entry.inspector, row);
    return map;
  }, new Map<string, { name: string; completed: number; attention: number }>()).values()).sort((a, b) => b.completed - a.completed);
  const repeats = Array.from(issues.reduce((map, issue) => {
    const key = `${issue.truck}|${issue.title}`;
    const row = map.get(key) || { truck: issue.truck, title: issue.title, count: 0, active: 0 };
    row.count += 1;
    if (issue.status !== "resolved") row.active += 1;
    map.set(key, row);
    return map;
  }, new Map<string, { truck: string; title: string; count: number; active: number }>()).values()).filter((row) => row.count > 1).sort((a, b) => b.count - a.count).slice(0, 8);

  function downloadCsv() {
    const rows = [
      ["Date", "Truck", "Frequency", "Inspector", "Complete", "Items checked", "Needs attention", "Submitted by"],
      ...entries.map((entry) => [entry.inspectionDate, entry.truck, entry.cadence, entry.inspector, entry.completedAt ? "Yes" : "No", entry.answers.length, entry.answers.filter((answer) => answer.status === "attention").length, entry.submittedByEmail]),
    ];
    const blob = new Blob([rows.map((row) => row.map(csvCell).join(",")).join("\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `fleet-checklists-${today}.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  return (
    <section className="ops-card ops-fleet-reports-card">
      <div className="ops-card-header compact ops-maintenance-header">
        <div><div className="ops-section-title">Fleet Reports & Accountability</div><div className="ops-muted">Inspection activity, recurring problems, maintenance spend, and downtime.</div></div>
        <div className="ops-report-actions"><button type="button" className="ops-button" onClick={downloadCsv}>Export CSV</button><button type="button" className="ops-refresh-button" onClick={() => window.print()}>Print report</button></div>
      </div>
      <div className="ops-report-kpis">
        <div><span>Inspections · 30d</span><strong>{completed.length}</strong><small>{recentEntries.length - completed.length} incomplete</small></div>
        <div><span>Open repairs</span><strong>{activeIssues.length}</strong><small>{activeIssues.filter((issue) => issue.severity === "out_of_service").length} out of service</small></div>
        <div><span>Maintenance spend · 30d</span><strong>{money(maintenanceSpend)}</strong><small>completed records</small></div>
        <div><span>Downtime · 30d</span><strong>{downtime.toFixed(1)}h</strong><small>repair history</small></div>
      </div>
      <div className="ops-report-grid">
        <div><div className="ops-section-title">Inspector Activity · 30 Days</div>{inspectors.length ? <table className="ops-table"><thead><tr><th>Inspector</th><th>Completed</th><th>Issues found</th></tr></thead><tbody>{inspectors.slice(0, 10).map((row) => <tr key={row.name}><td><strong>{row.name}</strong></td><td>{row.completed}</td><td>{row.attention}</td></tr>)}</tbody></table> : <p className="ops-muted">No completed inspections yet.</p>}</div>
        <div><div className="ops-section-title">Repeat Problems</div>{repeats.length ? <table className="ops-table"><thead><tr><th>Truck</th><th>Problem</th><th>Occurrences</th></tr></thead><tbody>{repeats.map((row) => <tr key={`${row.truck}-${row.title}`}><td><strong>{row.truck}</strong></td><td>{row.title}{row.active ? <small>{row.active} still active</small> : null}</td><td>{row.count}</td></tr>)}</tbody></table> : <p className="ops-muted">No repeat repair patterns yet.</p>}</div>
      </div>
    </section>
  );
}
