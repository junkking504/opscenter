"use client";
import { useEffect, useRef, useState } from "react";
import { INSPECTION_SECTIONS, INSPECTION_STATUSES, inspectionDate, type InspectionDevice, type InspectionStatus, type InspectionSectionId, type TruckInspectionInput, type TruckInspectionReport } from "@/lib/truck-inspection";
import { inspectionDraft } from "@/lib/truck-inspection-draft";
import styles from "./truck-inspection.module.css";

type Draft = Omit<TruckInspectionInput, "status"> & { status: InspectionStatus | ""; step: number; sent: boolean };
type Context = { device: InspectionDevice; inspectors: string[]; date: string };
function emptyDraft(): Draft { return { requestId: crypto.randomUUID(), inspector: "", odometer: "", fuel: "", startedAt: new Date().toISOString(), answers: [], photos: [], status: "", notes: "", initials: "", step: 0, sent: false }; }
async function api(url: string, body?: unknown) {
  const response = await fetch(url, { method: body ? "POST" : "GET", headers: body ? { "Content-Type": "application/json" } : {}, body: body ? JSON.stringify(body) : undefined, cache: "no-store", signal: AbortSignal.timeout(25_000) });
  const value = await response.json();
  if (!response.ok) throw Object.assign(new Error(value.error || "OpsCenter could not receive this report."), { status: response.status });
  return value;
}
async function photoData(file: File): Promise<string> {
  if (file.size > 25_000_000) throw new Error("Choose a photo under 25 MB.");
  const url = URL.createObjectURL(file);
  try {
    const image = new Image(); image.src = url; await image.decode();
    const ratio = Math.min(1, 1280 / Math.max(image.width, image.height));
    const canvas = document.createElement("canvas"); canvas.width = Math.round(image.width * ratio); canvas.height = Math.round(image.height * ratio);
    const context = canvas.getContext("2d"); if (!context) throw new Error("Unable to prepare this photo.");
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    let data = canvas.toDataURL("image/jpeg", .75);
    if (data.length > 1_000_000) data = canvas.toDataURL("image/jpeg", .45);
    if (data.length > 1_000_000) throw new Error("This photo is too large. Take a closer photo of the problem.");
    return data;
  } finally { URL.revokeObjectURL(url); }
}
export default function TruckInspectionApp() {
  const [context, setContext] = useState<Context | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [receipt, setReceipt] = useState<TruckInspectionReport | null>(null);
  const [setup, setSetup] = useState(false);
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState("");
  const [online, setOnline] = useState(true);
  const mutex = useRef(false);
  const saveSequence = useRef(Promise.resolve());
  const heading = useRef<HTMLHeadingElement>(null);
  async function load() {
    try {
      const data: Context = await api("/api/truck-inspection"); setContext(data); setSetup(false);
      try { const stored = await inspectionDraft<Draft>(data.device.deviceId, "read"); setDraft(stored || emptyDraft()); }
      catch { setSaved("Phone storage unavailable. Keep this page open until OpsCenter receives the report."); setDraft(emptyDraft()); }
    } catch (e) { if ((e as { status?: number }).status === 401) setSetup(true); else setError("Cannot connect to OpsCenter. Reconnect and try again."); }
  }
  useEffect(() => { const setupCode = new URLSearchParams(location.hash.slice(1)).get("setup"); if (setupCode) { setCode(setupCode); history.replaceState(null, "", location.pathname); } void load(); const update = () => setOnline(navigator.onLine); update(); window.addEventListener("online", update); window.addEventListener("offline", update); return () => { window.removeEventListener("online", update); window.removeEventListener("offline", update); }; }, []);
  useEffect(() => {
    if (!draft || !context || receipt) return;
    const next = draft;
    saveSequence.current = saveSequence.current.catch(() => undefined).then(async () => {
      await inspectionDraft(context.device.deviceId, "write", next);
      setSaved("Draft saved on this phone");
    }).catch(() => setSaved("Could not save on this phone. Keep this page open until OpsCenter receives the report."));
  }, [draft, context, receipt]);
  useEffect(() => { heading.current?.focus(); }, [draft?.step, receipt]);
  function change(values: Partial<Draft>) { setDraft(previous => previous && !previous.sent ? { ...previous, ...values } : previous); setError(""); }
  async function pair(event: React.FormEvent) {
    event.preventDefault(); if (mutex.current) return; mutex.current = true; setBusy(true); setError("");
    try { await api("/api/truck-inspection", { action: "pair", code: code.trim() }); await load(); }
    catch (e) { setError((e as Error).message); } finally { mutex.current = false; setBusy(false); }
  }
  async function confirmReport(report: TruckInspectionReport) {
    if (!context || !draft || report.requestId !== draft.requestId || report.deviceId !== context.device.deviceId || report.truck !== context.device.truck || !report.receivedAt) throw new Error("The receipt did not match this report. Check the saved result.");
    setReceipt(report); setError("");
    await saveSequence.current;
    await inspectionDraft(context.device.deviceId, "remove").catch(() => undefined);
  }
  async function submit() {
    if (!draft || mutex.current) return; mutex.current = true; setBusy(true); setError("");
    const frozen = { ...draft, sent: true }; setDraft(frozen);
    try {
      if (context) { await saveSequence.current; await inspectionDraft(context.device.deviceId, "write", frozen).catch(() => undefined); }
      const { step: _step, sent: _sent, ...report } = frozen;
      const body = await api("/api/truck-inspection", { action: "submit", report });
      await confirmReport(body.report);
    } catch (e) {
      const status = (e as { status?: number }).status;
      if (status === 400 || status === 413) setDraft(previous => previous && { ...previous, sent: false });
      setError(status ? (e as Error).message : "Receipt not confirmed. Keep this report and check the saved result before retrying.");
    } finally { mutex.current = false; setBusy(false); }
  }
  async function checkResult() {
    if (!draft || mutex.current) return; mutex.current = true; setBusy(true); setError("");
    try { const body = await api(`/api/truck-inspection?requestId=${encodeURIComponent(draft.requestId)}`); if (body.report) await confirmReport(body.report); else setError("OpsCenter has no saved report with this reference yet. Use Send same report to retry safely."); }
    catch (e) { setError((e as Error).message); } finally { mutex.current = false; setBusy(false); }
  }
  async function addPhoto(file: File | undefined, section: InspectionSectionId) {
    if (!file || !draft || busy) return; setBusy(true); setError("");
    try { if (draft.photos.length >= 3) throw new Error("You can attach up to three photos."); const data = await photoData(file); change({ photos: [...draft.photos, { section, data }] }); }
    catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  const section = draft && draft.step >= 1 && draft.step <= 5 ? INSPECTION_SECTIONS[draft.step - 1] : null;
  const answer = draft?.answers.find(a => a.id === section?.id);
  const answered = draft?.answers.length || 0;
  const problemCount = draft?.answers.filter(a => a.status === "problem").length || 0;
  const canSend = draft && answered === 5 && draft.initials.trim() && draft.status && !(problemCount && draft.status === "clear") && !(draft.status === "reported" && !problemCount) && !(draft.status === "stop" && !problemCount && !draft.notes.trim());
  return <main className={styles.app}>
    <header className={styles.brand}><span>JUNK KING <small>LOUISIANA</small></span><b>TRUCK CHECK</b></header>
    <div className={styles.shell}>
      <div className={styles.eyebrow}>DAILY · BEFORE THE FIRST ROUTE</div>
      {setup ? <section className={styles.card}><h1 ref={heading} tabIndex={-1}>Set up this truck phone</h1><p>Enter the one-time setup code from OpsCenter. This phone will remember its truck.</p><form onSubmit={pair}><label>Setup code<input autoCapitalize="none" autoCorrect="off" value={code} onChange={e => setCode(e.target.value)} required maxLength={24} /></label><button className={styles.primary} disabled={busy}>{busy ? "Setting up…" : "Connect truck phone"}</button></form><p className={styles.muted}>Your manager creates a code in Fleet → Morning inspections.</p></section>
      : !context || !draft ? <section className={styles.card}><h1>Morning inspection</h1><p>{error || "Connecting to OpsCenter…"}</p>{error && <button onClick={() => { setError(""); void load(); }}>Try again</button>}</section>
      : receipt ? <section className={styles.card}>
        <div className={styles.received}>✓ RECEIVED BY OPSCENTER</div><h1 ref={heading} tabIndex={-1}>{receipt.truck} inspection saved</h1>
        <p className={receipt.status === "stop" ? styles.stop : styles.status}>{INSPECTION_STATUSES[receipt.status]}</p>
        {receipt.status === "stop" && <p className={styles.stop}>Do not operate this truck. Contact your supervisor.</p>}
        <dl className={styles.summary}><dt>Inspector</dt><dd>{receipt.inspector}</dd><dt>Mileage</dt><dd>{Number(receipt.odometer).toLocaleString()} mi</dd><dt>Fuel</dt><dd>{receipt.fuel}</dd><dt>Received</dt><dd>{new Date(receipt.receivedAt).toLocaleString()}</dd><dt>Photos</dt><dd>{receipt.photos.length}</dd></dl>
        {receipt.answers.map(a => <p key={a.id}>{a.status === "good" ? "✓" : "!"} {INSPECTION_SECTIONS.find(s => s.id === a.id)?.label}: {a.status === "good" ? "Good" : a.notes}</p>)}
        <p className={styles.muted}>Reference: {receipt.requestId}</p><button onClick={() => { setReceipt(null); setDraft(emptyDraft()); }}>Start another inspection</button>
      </section> : <>
        <div className={styles.truckHeading}><h1>{context.device.truck}</h1><span>{inspectionDate(new Date(draft.startedAt))}</span></div>
        {!online && <p className={styles.offline}>No connection. Continue checking the truck; reconnect to send.</p>}
        <div className={styles.progress} aria-label={`${answered} of 5 sections checked`}>{INSPECTION_SECTIONS.map(s => <span key={s.id} data-result={draft.answers.find(a => a.id === s.id)?.status || ""} />)}</div>
        <section className={styles.card}>
          {draft.step === 0 ? <form onSubmit={e => { e.preventDefault(); if (draft.inspector.trim() && /^\d{1,8}$/.test(draft.odometer)) change({ step: 1, startedAt: new Date().toISOString() }); }}>
            <h2 ref={heading} tabIndex={-1}>Ready for the morning check?</h2><p>Choose your name, record the mileage, then walk through five quick sections.</p>
            <label>Your name<input list="inspection-crew" value={draft.inspector} onChange={e => change({ inspector: e.target.value })} required maxLength={100} autoComplete="off" placeholder="Who is inspecting today?" /></label><datalist id="inspection-crew">{context.inspectors.map(name => <option key={name} value={name} />)}</datalist>
            <label>Odometer · miles<input inputMode="numeric" pattern="[0-9]{1,8}" value={draft.odometer} onChange={e => change({ odometer: e.target.value })} required maxLength={8} placeholder="Enter the mileage" /></label>
            <button className={styles.primary} type="submit">Start inspection <span>→</span></button>
          </form> : section ? <>
            <div className={styles.eyebrow}>CHECK {draft.step} OF 5</div><h2 ref={heading} tabIndex={-1}>{section.label}</h2>
            <ul className={styles.checks}>{section.checks.map(check => <li key={check}>{check}</li>)}</ul>
            <div className={styles.choices} role="group" aria-label={`${section.label} result`}>{(["good", "problem"] as const).map(status => <button key={status} type="button" aria-pressed={answer?.status === status} data-choice={status} onClick={() => change({ answers: [...draft.answers.filter(a => a.id !== section.id), { id: section.id, status, notes: answer?.notes || "" }], status: "" })}>{status === "good" ? "✓ Good" : "! Problem"}</button>)}</div>
            {section.id === "dashboard" && <label>Fuel level<select value={draft.fuel} onChange={e => change({ fuel: e.target.value })}><option value="">Choose fuel level</option>{["Empty", "1/4", "1/2", "3/4", "Full"].map(f => <option key={f}>{f}</option>)}</select></label>}
            {answer?.status === "problem" && <div className={styles.problemBox}><label>What did you find?<textarea required maxLength={1000} value={answer.notes} placeholder="Describe the problem so the supervisor knows what needs attention." onChange={e => change({ answers: draft.answers.map(a => a.id === section.id ? { ...a, notes: e.target.value } : a) })} /></label><label className={styles.photoButton}>Add a photo · optional<input type="file" accept="image/*" capture="environment" disabled={busy || draft.photos.length >= 3} onChange={e => { void addPhoto(e.target.files?.[0], section.id); e.target.value = ""; }} /></label><div className={styles.photos}>{draft.photos.map((p, index) => p.section === section.id && <figure key={index}><img src={p.data} alt={`${section.label} problem photo`} /><button aria-label={`Remove photo ${index + 1}`} onClick={() => change({ photos: draft.photos.filter((_, i) => i !== index) })}>Remove</button></figure>)}</div></div>}
            <div className={styles.actions}><button onClick={() => change({ step: draft.step - 1 })} disabled={busy}>Back</button><button className={styles.primary} disabled={busy || !answer || (answer.status === "problem" && !answer.notes.trim()) || (section.id === "dashboard" && !draft.fuel)} onClick={() => change({ step: draft.step + 1 })}>{draft.step === 5 ? "Review report" : "Next check"} →</button></div>
          </> : <>
            <h2 ref={heading} tabIndex={-1}>Review & send</h2><p>{draft.inspector} · {Number(draft.odometer).toLocaleString()} miles · Fuel {draft.fuel}</p>
            {INSPECTION_SECTIONS.map((s, i) => { const a = draft.answers.find(a => a.id === s.id); return <div className={styles.reviewRow} key={s.id}><div><strong>{s.label}</strong><p>{a?.status === "good" ? "✓ Good" : `! ${a?.notes || "Not checked"}`}</p></div><button disabled={draft.sent || busy} onClick={() => change({ step: i + 1 })}>Edit</button></div>; })}
            <fieldset disabled={draft.sent || busy}><legend>Final operating status</legend>{Object.entries(INSPECTION_STATUSES).map(([value, label]) => <label className={styles.radio} key={value}><input type="radio" name="final-status" value={value} checked={draft.status === value} disabled={(value === "clear" && problemCount > 0) || (value === "reported" && !problemCount)} onChange={() => change({ status: value as InspectionStatus })} />{label}</label>)}
              <label>Additional notes{draft.status === "stop" && !problemCount ? " · required" : " · optional"}<textarea maxLength={2000} value={draft.notes} onChange={e => change({ notes: e.target.value })} /></label>
              <label>Your initials<input maxLength={12} value={draft.initials} onChange={e => change({ initials: e.target.value })} autoComplete="off" /></label><p className={styles.muted}>By initialing, I confirm I performed these checks and recorded the conditions I found.</p>
            </fieldset>
            {draft.status === "stop" && <p className={styles.stop}>Do not operate the truck. Contact your supervisor.</p>}
            {draft.sent && <p className={styles.offline}>This report has been sent, but receipt is not confirmed yet. Check the saved result or resend the same report.</p>}
            <p className={styles.muted}>{draft.photos.length} photo{draft.photos.length === 1 ? "" : "s"} included</p>
            <div className={styles.actions}>{!draft.sent && <button disabled={busy} onClick={() => change({ step: 5 })}>Back</button>}<button className={styles.primary} disabled={busy || !canSend} onClick={() => void submit()}>{busy ? "Checking with OpsCenter…" : draft.sent ? "Send same report" : "Send to OpsCenter"}</button></div>
            {draft.sent && <button className={styles.fullWidth} disabled={busy} onClick={() => void checkResult()}>Check saved result</button>}
          </>}
        </section><p className={styles.saved} role="status">{saved}</p>
      </>}
      {error && context && <p role="alert" className={styles.error}>{error}</p>}{error && setup && <p role="alert" className={styles.error}>{error}</p>}
      <footer className={styles.footer}>When in doubt, do not operate. Notify a supervisor.<br /><span>Daily visual inspection · Follow company and manufacturer procedures.</span></footer>
    </div>
  </main>;
}
