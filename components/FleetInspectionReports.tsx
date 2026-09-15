"use client";
import { useEffect, useState } from "react";
import { INSPECTION_SECTIONS, INSPECTION_STATUSES, inspectionDate, type InspectionDevice, type TruckInspectionReport } from "@/lib/truck-inspection";
import styles from "./truck-inspection.module.css";
type Snapshot = { date: string; trucks: string[]; reports: TruckInspectionReport[]; devices: InspectionDevice[]; canManage: boolean };
async function request(body?: unknown, date?: string) {
  const response = await fetch(`/api/fleet-inspections${date ? `?date=${encodeURIComponent(date)}` : ""}`, { method: body ? "POST" : "GET", headers: body ? { "Content-Type": "application/json" } : {}, body: body ? JSON.stringify(body) : undefined, cache: "no-store" });
  const value = await response.json(); if (!response.ok) throw new Error(value.error || "Unable to load inspection reports."); return value;
}
export default function FleetInspectionReports() {
  const [date, setDate] = useState(inspectionDate());
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [error, setError] = useState(""); const [busy, setBusy] = useState(false);
  const [truck, setTruck] = useState(""); const [label, setLabel] = useState("");
  const [pairing, setPairing] = useState<{ code: string; expiresAt: string; truck: string } | null>(null);
  const [filter, setFilter] = useState("");
  useEffect(() => { let active = true; setSnapshot(null); setError(""); request(undefined, date).then(value => { if (active) setSnapshot(value); }).catch(e => { if (active) setError(e.message); }); return () => { active = false; }; }, [date]);
  async function refresh() { setError(""); try { setSnapshot(await request(undefined, date)); } catch (e) { setError((e as Error).message); } }
  async function action(body: unknown) { setBusy(true); setError(""); try { const result = await request(body); await refresh(); return result; } catch (e) { setError((e as Error).message); } finally { setBusy(false); } }
  const reports = snapshot?.reports.filter(r => !filter || r.truck === filter) || [];
  const submitted = new Set(snapshot?.reports.map(r => r.truck));
  const missing = snapshot?.trucks.filter(t => !submitted.has(t)) || [];
  return <main className={styles.app}><header className={styles.brand}><span>JUNK KING <small>LOUISIANA</small></span><b>OPSCENTER · FLEET</b></header><div className={`${styles.shell} ${styles.manage}`}>
    <a href="/desktop?data=live&workspace=Fleet" className={styles.noPrint}>← Back to Fleet</a>
    <div className={styles.reviewHeader}><div><div className={styles.eyebrow}>COMPANY TRUCK PHONES</div><h1>Morning inspections</h1></div><button onClick={() => void refresh()} disabled={busy}>Refresh reports</button></div>
    <div className={`${styles.reviewHeader} ${styles.noPrint}`}><label>Inspection date<input type="date" value={date} onChange={e => { if (e.target.value) setDate(e.target.value); }} /></label><label>Truck<select value={filter} onChange={e => setFilter(e.target.value)}><option value="">All trucks</option>{snapshot?.trucks.map(t => <option key={t}>{t}</option>)}</select></label></div>
    {error && <p className={styles.error} role="alert">{error}</p>}
    {!snapshot ? <p>Loading inspection reports…</p> : <>
      <div className={styles.stats}><span><b>{submitted.size}</b> trucks inspected</span><span><b>{missing.length}</b> without a report</span><span><b>{snapshot.reports.filter(r => r.status !== "clear").length}</b> reports with concerns</span></div>
      {missing.length > 0 && <p className={styles.offline}>No five-point report received for: {missing.join(", ")}. Trucks that are not operating may not need a morning report.</p>}
      <div className={styles.reportGrid}>{!reports.length && <p>No reports received for this selection.</p>}{reports.map(r => <details key={`${r.deviceId}:${r.requestId}`}>
        <summary><strong>{r.truck} · {r.inspector}</strong><span>{new Date(r.startedAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}</span><span className={styles.badge} data-status={r.status}>{INSPECTION_STATUSES[r.status]}</span></summary>
        {r.status === "stop" && <p className={styles.stop}>Driver reported DO NOT OPERATE. Arrange supervisor review before operating. A later good inspection is not evidence of a repair.</p>}
        <dl className={styles.summary}><dt>Mileage</dt><dd>{Number(r.odometer).toLocaleString()} mi</dd><dt>Fuel</dt><dd>{r.fuel}</dd><dt>Initials</dt><dd>{r.initials}</dd><dt>Started</dt><dd>{new Date(r.startedAt).toLocaleString()}</dd><dt>Received</dt><dd>{new Date(r.receivedAt).toLocaleString()}</dd></dl>
        {INSPECTION_SECTIONS.map(s => { const a = r.answers.find(a => a.id === s.id); return <div className={styles.reviewRow} key={s.id}><div><strong>{s.label}</strong><p>{a?.status === "good" ? "✓ Good" : `Problem: ${a?.notes}`}</p>{a?.status === "good" && a.notes && <p>Notes: {a.notes}</p>}</div></div>; })}
        {r.notes && <p><b>Additional notes:</b> {r.notes}</p>}<div className={styles.photos}>{r.photos.map((p,i) => <figure key={i}><a href={p.data} download={`${r.truck}-${p.section}-${i+1}.jpg`}><img src={p.data} alt={`${INSPECTION_SECTIONS.find(s => s.id === p.section)?.label} inspection photo ${i+1}`} /></a><figcaption>{INSPECTION_SECTIONS.find(s => s.id === p.section)?.label}</figcaption></figure>)}</div>
        <p className={styles.muted}>Received from a phone assigned to {r.truck}. Inspector name and initials were entered on the shared phone.<br />Report reference: {r.requestId}</p>
        <button className={styles.noPrint} onClick={() => window.print()}>Print open reports</button>
      </details>)}</div>
      {snapshot.canManage && <details className={`${styles.card} ${styles.noPrint}`} style={{ marginTop: 28 }}><summary><strong>Manage truck phones</strong></summary><p>Connect each phone once. The phone can submit and check its own inspection reports; it cannot open management records.</p>
        <form onSubmit={async e => { e.preventDefault(); const result = await action({ action: "pair", truck, label }); if (result) setPairing(result); }}><label>Assigned truck<select required value={truck} onChange={e => setTruck(e.target.value)}><option value="">Choose truck</option>{snapshot.trucks.map(t => <option key={t}>{t}</option>)}</select></label><label>Phone name<input required maxLength={100} placeholder="Truck 4 company phone" value={label} onChange={e => setLabel(e.target.value)} /></label><button className={styles.primary} disabled={busy}>Create one-time setup code</button></form>
        {pairing && <section><h3>{pairing.truck} setup code</h3><p className={styles.setupCode}>{pairing.code}</p><p>On the truck phone, open <a href={`https://hooks.junk-king.app/truck-inspection#setup=${pairing.code}`}>Truck Check setup</a>, connect the phone, then add the page to the home screen. You can also enter the code manually.</p><p className={styles.muted}>Single use · Expires {new Date(pairing.expiresAt).toLocaleString()}. Keep the code private. If the setup result is uncertain, create a new code.</p></section>}
        <h3>Connected phones</h3>{snapshot.devices.length === 0 && <p>No phones connected yet.</p>}{snapshot.devices.map(d => <div className={styles.reviewRow} key={d.deviceId}><div><strong>{d.truck} · {d.label}</strong><p>Connected {new Date(d.createdAt).toLocaleDateString()} · Expires {new Date(d.expiresAt).toLocaleDateString()}</p></div><button disabled={busy} onClick={() => void action({ action: "revoke", deviceId: d.deviceId })}>Disconnect</button></div>)}
      </details>}
    </>}
  </div></main>;
}
