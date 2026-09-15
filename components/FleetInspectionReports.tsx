"use client";
import { useEffect, useRef, useState } from "react";
import { INSPECTION_SECTIONS, INSPECTION_STATUSES, inspectionDate, type InspectionDevice, type TruckInspectionReport } from "@/lib/truck-inspection";
import styles from "./truck-inspection.module.css";
type Snapshot = { date: string; trucks: string[]; reports: TruckInspectionReport[]; devices: InspectionDevice[]; canManage: boolean };
async function request(body?: unknown, date?: string) {
  const response = await fetch(`/api/fleet-inspections${date ? `?date=${encodeURIComponent(date)}` : ""}`, { method: body ? "POST" : "GET", headers: body ? { "Content-Type": "application/json" } : {}, body: body ? JSON.stringify(body) : undefined, cache: "no-store" });
  const value = await response.json(); if (!response.ok) throw new Error(value.error || "Unable to load inspection reports."); return value;
}
const reportKey = (r: TruckInspectionReport) => `${r.deviceId}:${r.requestId}`;
const time = (value: string) => new Date(value).toLocaleTimeString([], { hour: "numeric", minute: "2-digit", timeZone: "America/Chicago" });
export default function FleetInspectionReports() {
  const [date, setDate] = useState(inspectionDate());
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [error, setError] = useState(""); const [busy, setBusy] = useState(false);
  const [filter, setFilter] = useState(""); const [statusFilter, setStatusFilter] = useState("");
  const [selected, setSelected] = useState(""); const [manageOpen, setManageOpen] = useState(false);
  const generation = useRef(0); const detail = useRef<HTMLElement>(null);
  useEffect(() => { const id = ++generation.current; setSnapshot(null); setError(""); request(undefined, date).then(value => { if (generation.current === id) setSnapshot(value); }).catch(e => { if (generation.current === id) setError(e.message); }); return () => { generation.current = id + 1; }; }, [date]);
  async function refresh() { const id = ++generation.current; setError(""); try { const value = await request(undefined, date); if (generation.current === id) setSnapshot(value); } catch (e) { if (generation.current === id) setError((e as Error).message); } }
  async function action(body: unknown) { setBusy(true); setError(""); try { const result = await request(body); await refresh(); return result; } catch (e) { setError((e as Error).message); } finally { setBusy(false); } }
  const submitted = new Set(snapshot?.reports.map(r => r.truck));
  const missing = snapshot?.trucks.filter(t => !submitted.has(t)) || [];
  const entries: { key: string; truck: string; status: string; report?: TruckInspectionReport }[] = [
    ...(snapshot?.reports || []).map(r => ({ key: reportKey(r), truck: r.truck, status: r.status, report: r })),
    ...missing.map(t => ({ key: `missing:${t}`, truck: t, status: "missing", report: undefined })),
  ].filter(r => (!filter || r.truck === filter) && (!statusFilter || r.status === statusFilter)).sort((a,b) => {
    const rank: Record<string, number> = { stop: 0, reported: 1, missing: 2, clear: 3 };
    return rank[a.status] - rank[b.status] || (b.report?.receivedAt || "").localeCompare(a.report?.receivedAt || "") || a.truck.localeCompare(b.truck, undefined, { numeric: true });
  });
  const chosen = entries.find(e => e.key === selected) || entries[0];
  const report = chosen?.report;
  function choose(key: string) { setSelected(key); if (window.matchMedia("(max-width: 900px)").matches) requestAnimationFrame(() => { detail.current?.focus(); detail.current?.scrollIntoView({ behavior: "smooth", block: "start" }); }); }
  return <main className={`${styles.app} ${styles.managerApp}`}>
    <header className={`${styles.brand} ${styles.noPrint}`}><span>JUNK KING</span><span className={styles.brandDivider}>/</span><b>OPSCENTER · FLEET</b></header>
    <div className={styles.manage}>
      <a href="/desktop?data=live&workspace=Fleet" className={styles.noPrint}>← Back to Fleet</a>
      <div className={styles.reviewHeader}><div><div className={styles.eyebrow}>COMPANY TRUCK PHONES</div><h1>Morning inspections</h1><p className={styles.muted}>{date} · Times shown in Central time</p></div><button className={styles.noPrint} onClick={() => void refresh()} disabled={busy}>Refresh reports</button></div>
      {error && <p className={styles.error} role="alert">{error}</p>}
      {!snapshot ? <p>{error ? "Reports could not be loaded. Try Refresh reports." : "Loading inspection reports…"}</p> : <>
        <div className={styles.stats}><span><b>{submitted.size} / {snapshot.trucks.length}</b> inspected</span><span><b>{missing.length}</b> missing</span><span data-status="stop"><b>{snapshot.reports.filter(r => r.status === "stop").length}</b> do not operate reports</span><span data-status="reported"><b>{snapshot.reports.filter(r => r.status === "reported").length}</b> problem reports</span></div>
        <div className={`${styles.filters} ${styles.noPrint}`}><label>Inspection date<input type="date" value={date} onChange={e => { if (e.target.value) setDate(e.target.value); }} /></label><label>Truck<select value={filter} onChange={e => setFilter(e.target.value)}><option value="">All trucks</option>{snapshot.trucks.map(t => <option key={t}>{t}</option>)}</select></label><label>Status<select value={statusFilter} onChange={e => setStatusFilter(e.target.value)}><option value="">All statuses</option><option value="stop">Do not operate</option><option value="reported">Problem reported</option><option value="missing">Missing inspection</option><option value="clear">No problems</option></select></label>{snapshot.canManage && <button onClick={() => { setManageOpen(true); requestAnimationFrame(() => document.getElementById("phone-management")?.scrollIntoView({ behavior: "smooth" })); }}>Manage truck phones</button>}</div>
        <p className={`${styles.muted} ${styles.noPrint}`}>Missing means no report received for this date. Trucks that are not operating may not need a morning report.</p>
        <div className={styles.reportWorkspace}>
          <div className={`${styles.reportList} ${styles.noPrint}`} aria-label="Inspection reports">{entries.length === 0 ? <p className={styles.emptyState}>No reports match these filters.</p> : entries.map(e => <button key={e.key} className={styles.reportItem} data-selected={chosen?.key === e.key} aria-pressed={chosen?.key === e.key} onClick={() => choose(e.key)}><strong>{e.truck}{e.report ? ` · ${e.report.inspector}` : ""}</strong><span className={styles.rowStatus} data-status={e.status}>{e.status === "missing" ? "Missing inspection" : INSPECTION_STATUSES[e.report!.status]}</span><small>{e.report ? `Received ${time(e.report.receivedAt)}${e.report.answers.some(a => a.status === "problem") ? ` · ${e.report.answers.filter(a => a.status === "problem").map(a => INSPECTION_SECTIONS.find(s => s.id === a.id)?.label).join(", ")}` : ""}` : "No report received for this date"}</small></button>)}</div>
          <section ref={detail} tabIndex={-1} className={styles.reportDetail} aria-label="Selected inspection report">
            {!chosen ? <div className={styles.emptyState}><h2>No report selected</h2><p>Change the filters to find an inspection.</p></div> : !report ? <><h2>{chosen.truck}</h2><p className={styles.badge}>Missing inspection</p><p>No five-point report has been received for {date}.</p><p className={styles.muted}>This does not establish whether the truck was scheduled to operate.</p></> : <>
              <h2>{report.truck}</h2><p className={styles.intro}>Received {time(report.receivedAt)} · {report.inspector}</p>
              <div className={styles.decisionCard} data-status={report.status}><h3>{INSPECTION_STATUSES[report.status]}</h3>{report.status === "stop" && <p>Driver reported DO NOT OPERATE. Arrange supervisor review before operating. A later good inspection is not evidence of a repair.</p>}</div>
              <dl className={styles.summary}><dt>Mileage</dt><dd>{Number(report.odometer).toLocaleString()} mi</dd><dt>Truck fullness</dt><dd>{report.loadLevel || "Not recorded"}</dd><dt>Fuel tank</dt><dd>{report.fuel}</dd><dt>Initials</dt><dd>{report.initials}</dd><dt>Started</dt><dd>{new Date(report.startedAt).toLocaleString([], { timeZone: "America/Chicago" })}</dd><dt>Received</dt><dd>{new Date(report.receivedAt).toLocaleString([], { timeZone: "America/Chicago" })}</dd></dl>
              {INSPECTION_SECTIONS.map(s => { const a = report.answers.find(a => a.id === s.id); return <div className={styles.reviewRow} key={s.id}><div><strong>{s.label}</strong><p className={styles.rowStatus} data-status={a?.status === "problem" ? "reported" : "clear"}>{a?.status === "good" ? "✓ Good" : "! Problem"}</p>{a?.notes && <p>{a.notes}</p>}</div></div>; })}
              {report.notes && <p><b>Additional notes:</b> {report.notes}</p>}
              <h3>Photos</h3>{!report.photos.length && <p className={styles.muted}>No photos attached.</p>}<div className={styles.photos}>{report.photos.map((p,i) => <figure key={i}><a href={p.data} download={`${report.truck}-${p.section}-${i+1}.jpg`}><img src={p.data} alt={`${INSPECTION_SECTIONS.find(s => s.id === p.section)?.label} inspection photo ${i+1}`} /></a><figcaption>{INSPECTION_SECTIONS.find(s => s.id === p.section)?.label}</figcaption></figure>)}</div>
              <p className={styles.reference}>Submitted report · Read only<br />Truck, inspector name and initials were entered for this inspection on a shared company phone.<br />Report reference: {report.requestId}</p>
              <button className={styles.noPrint} onClick={() => window.print()}>Print report</button>
            </>}
          </section>
        </div>
      {snapshot.canManage && <details id="phone-management" className={`${styles.card} ${styles.noPrint}`} open={manageOpen} onToggle={e => setManageOpen(e.currentTarget.open)}><summary><strong>Manage truck phones</strong></summary><p>On any company phone, open <a href="/truck-inspection">Truck Check</a> and choose the truck at the start of each inspection. Phones can move between trucks.</p><p className={styles.muted}>The phone connection keeps drafts and receipts together; it does not assign the phone to a truck. Disconnect ends the current connection.</p>
        <h3>Connected phones</h3>{snapshot.devices.length === 0 && <p>No phones connected yet.</p>}{snapshot.devices.map(d => <div className={styles.reviewRow} key={d.deviceId}><div><strong>Company phone · {d.deviceId.slice(0, 6)}</strong><p>Available for any truck<br />Connected {new Date(d.createdAt).toLocaleDateString()} · Expires {new Date(d.expiresAt).toLocaleDateString()}</p></div><button disabled={busy} onClick={() => void action({ action: "revoke", deviceId: d.deviceId })}>Disconnect</button></div>)}
      </details>}      </>}
    </div>
  </main>;
}
