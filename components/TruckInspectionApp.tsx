"use client";
import { truckDisplayText } from '../lib/junkware-trucks';
import { useEffect, useRef, useState } from "react";
import { INSPECTION_SECTIONS, INSPECTION_STATUSES, INSPECTION_LEVELS, inspectionDate, inspectionPhotoError, type InspectionDevice, type InspectionStatus, type InspectionSectionId, type TruckInspectionInput, type TruckInspectionReport } from "@/lib/truck-inspection";
import { inspectionDraft } from "@/lib/truck-inspection-draft";
import styles from "./truck-inspection.module.css";

type Draft = Omit<TruckInspectionInput, "status"> & { status: InspectionStatus | ""; step: number; sent: boolean; problemEditing?: boolean; returnToReview?: boolean };
type Context = { device: InspectionDevice; trucks: string[]; inspectors: string[]; date: string; dayVersion?: number; report?: TruckInspectionReport | null };
const CONNECTION_KEY = "truck-inspection-connection";
function emptyDraft(): Draft { return { requestId: crypto.randomUUID(), truck: "", inspector: "", odometer: "", fuel: "", loadLevel: "", startedAt: new Date().toISOString(), answers: [], photos: [], status: "", notes: "", initials: "", step: 0, sent: false }; }
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
export default function TruckInspectionApp({ onBusyChange, apiPath = "/api/truck-inspection", onContinue }: { onBusyChange?: (busy: boolean) => void; apiPath?: string; onContinue?: () => void }) {
  const [context, setContext] = useState<Context | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [receipt, setReceipt] = useState<TruckInspectionReport | null>(null);
  const connection = useRef<{ token: string } | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => { onBusyChange?.(busy); }, [busy, onBusyChange]);
  const [saved, setSaved] = useState("");
  const [online, setOnline] = useState(true);
  const [showReport, setShowReport] = useState(false);
  const lastAdvance = useRef(-Infinity);
  const mutex = useRef(false);
  const saveSequence = useRef(Promise.resolve());
  const heading = useRef<HTMLHeadingElement>(null);
  async function load() {
    try {
      let data = await api(apiPath);
      if (!data.device) {
        if (apiPath !== "/api/truck-inspection") throw new Error("Set up today’s truck phone first.");
        try { const pending = JSON.parse(localStorage.getItem(CONNECTION_KEY) || "null"); if (pending && /^[a-f0-9]{64}$/.test(pending.token)) connection.current = pending; } catch { /* The connection also works without localStorage. */ }
        if (!connection.current) connection.current = { token: Array.from(crypto.getRandomValues(new Uint8Array(32)), byte => byte.toString(16).padStart(2, "0")).join("") };
        try { localStorage.setItem(CONNECTION_KEY, JSON.stringify(connection.current)); } catch { /* The HTTP-only cookie remembers a successful connection. */ }
        await api(apiPath, { action: "connect", connectionToken: connection.current.token });
        data = await api(apiPath);
        if (!data.device) throw new Error("The browser did not keep the phone connection.");
      }
      try { if (apiPath === "/api/truck-inspection") localStorage.removeItem(CONNECTION_KEY); } catch { /* No pending connection to recover. */ }
      connection.current = null;
      setContext(data);
      if (data.report) { setReceipt(data.report); setDraft(emptyDraft()); return; }
      try {
        const stored = await inspectionDraft<Draft>(data.device.deviceId, "read");
        // Preserve the truck on unfinished drafts from the old phone-assignment flow.
        setDraft(stored ? { ...stored, truck: stored.truck ?? (stored.step > 0 ? data.device.truck || "" : "") } : { ...emptyDraft(), ...(apiPath !== "/api/truck-inspection" ? { truck: data.device.truck, inspector: data.inspectors[0] || "" } : {}) });
      } catch { setSaved("Phone storage unavailable. Keep this page open until OpsCenter receives the report."); setDraft({ ...emptyDraft(), ...(apiPath !== "/api/truck-inspection" ? { truck: data.device.truck, inspector: data.inspectors[0] || "" } : {}) }); }
    } catch (e) {
      if ((e as { status?: number }).status === 403) { connection.current = null; try { if (apiPath === "/api/truck-inspection") localStorage.removeItem(CONNECTION_KEY); } catch { /* Retry with a fresh connection. */ } }
      setError(e instanceof Error ? e.message : "Cannot connect to OpsCenter. Reconnect and try again.");
    }
  }
  useEffect(() => { if (location.hash) history.replaceState(null, "", location.pathname); void load(); const update = () => setOnline(navigator.onLine); update(); window.addEventListener("online", update); window.addEventListener("offline", update); return () => { window.removeEventListener("online", update); window.removeEventListener("offline", update); }; }, []);
  useEffect(() => {
    if (!draft || !context || receipt) return;
    const next = draft;
    saveSequence.current = saveSequence.current.catch(() => undefined).then(async () => {
      await inspectionDraft(context.device.deviceId, "write", next);
      setSaved("Draft saved on this phone");
    }).catch(() => setSaved("Could not save on this phone. Keep this page open until OpsCenter receives the report."));
  }, [draft, context, receipt]);
  useEffect(() => { heading.current?.focus(); }, [draft?.step, draft?.problemEditing, draft?.sent, receipt]);
  function change(values: Partial<Draft>) { setDraft(previous => previous && !previous.sent ? { ...previous, ...values } : previous); setError(""); }
  function chooseTruck(truck: string) {
    if (!draft || truck === draft.truck) return;
    if ((draft.answers.length || draft.photos.length) && !window.confirm("Changing trucks starts a new inspection and clears this unfinished checklist. Continue?")) return;
    setDraft({ ...emptyDraft(), truck, inspector: draft.inspector }); setError("");
  }
  async function confirmReport(report: TruckInspectionReport) {
    if (!context || !draft || report.requestId !== draft.requestId || report.deviceId !== context.device.deviceId || report.truck !== draft.truck || !report.receivedAt) throw new Error("The receipt did not match this report. Check the saved result.");
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
      const body = await api(apiPath, { action: "submit", report, ...(context?.dayVersion ? {dayVersion: context.dayVersion} : {}) });
      await confirmReport(body.report);
    } catch (e) {
      const status = (e as { status?: number }).status;
      if (status === 400 || status === 413) setDraft(previous => previous && { ...previous, sent: false });
      setError(status ? (e as Error).message : "Receipt not confirmed. Keep this report and check the saved result before retrying.");
    } finally { mutex.current = false; setBusy(false); }
  }
  async function checkResult() {
    if (!draft || mutex.current) return; mutex.current = true; setBusy(true); setError("");
    try { const body = await api(`${apiPath}?requestId=${encodeURIComponent(draft.requestId)}`); if (body.report) await confirmReport(body.report); else setError("OpsCenter has no saved report with this reference yet. Use Send same report to retry safely."); }
    catch (e) { setError((e as Error).message); } finally { mutex.current = false; setBusy(false); }
  }
  async function addPhoto(file: File | undefined, section: InspectionSectionId) {
    if (!file || !draft || busy) return; setBusy(true); setError("");
    try { if (draft.photos.length >= 5 || draft.photos.some(photo => photo.section === section)) throw new Error("Use one photo per section. Remove the current photo to replace it."); const data = await photoData(file); change({ photos: [...draft.photos, { section, data }] }); }
    catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  const section = draft && draft.step >= 1 && draft.step <= 5 ? INSPECTION_SECTIONS[draft.step - 1] : null;
  const answer = draft?.answers.find(a => a.id === section?.id);
  const problemCount = draft?.answers.filter(a => a.status === "problem").length || 0;
  const sectionHasPhoto = draft?.photos.some(photo => photo.section === section?.id);
  const photoError = draft ? inspectionPhotoError(draft.answers, draft.photos, draft.status) : "";
  const complete = draft && INSPECTION_SECTIONS.every(s => draft.answers.some(a => a.id === s.id && (a.status === "good" || (a.status === "problem" && a.notes.trim()))));
  const missingSectionLevel = (section?.id === "dashboard" && !draft?.fuel) || (section?.id === "operation" && !draft?.loadLevel);
  const canSend = draft && context?.trucks.includes(draft.truck) && complete && !photoError && draft.inspector.trim() && /^\d{1,8}$/.test(draft.odometer) && draft.fuel && draft.loadLevel && draft.initials.trim() && draft.status && !(problemCount && draft.status === "clear") && !(draft.status === "reported" && !problemCount) && !(draft.status === "stop" && !problemCount && !draft.notes.trim());
  function nextSection(good: boolean, eventTime: number) {
    if (!draft || !section || busy || draft.sent || missingSectionLevel) return;
    if (!good && (!answer || (answer.status === "problem" && (!answer.notes.trim() || !sectionHasPhoto)))) return;
    // A double tap must not mark two different inspection sections good.
    if (good && eventTime - lastAdvance.current < 450) return;
    lastAdvance.current = eventTime;
    change({
      ...(good ? { answers: [...draft.answers.filter(a => a.id !== section.id), { id: section.id, status: "good" as const, notes: answer?.notes || "" }], status: "" as const } : {}),
      step: draft.returnToReview ? 6 : draft.step === 5 ? 7 : draft.step + 1,
      problemEditing: false, returnToReview: false,
    });
  }
  const errors = error && <p role="alert" className={styles.error}>{error}</p>;
  const back = (step: number, label = "Back") => <button className={styles.backButton} disabled={busy} onClick={() => change({ step, problemEditing: false })}>← {label}</button>;
  const saveStatus = <span className={styles.saved} role="status">{saved || "Saving on this phone…"}</span>;
  const reportBody = (report: TruckInspectionReport) => <>
    <dl className={styles.summary}><dt>Inspector</dt><dd>{report.inspector}</dd><dt>Mileage</dt><dd>{Number(report.odometer).toLocaleString()} mi</dd><dt>Truck fullness</dt><dd>{report.loadLevel || "Not recorded"}</dd><dt>Fuel tank</dt><dd>{report.fuel}</dd><dt>Received</dt><dd>{new Date(report.receivedAt).toLocaleString()}</dd><dt>Initials</dt><dd>{report.initials}</dd></dl>
    {report.answers.map(a => <div className={styles.reviewRow} key={a.id}><div><strong>{INSPECTION_SECTIONS.find(s => s.id === a.id)?.label}</strong><p>{a.status === "good" ? "✓ Good" : "! Problem"}</p>{a.notes && <p>{a.notes}</p>}</div></div>)}
    {report.notes && <p>{report.notes}</p>}
    <div className={styles.photos}>{report.photos.map((p, i) => <figure key={i}><img src={p.data} alt={`${INSPECTION_SECTIONS.find(s => s.id === p.section)?.label} inspection photo ${i + 1}`} /></figure>)}</div>
    <p className={styles.reference}>Report reference: {report.requestId}</p>
  </>;
  return <main className={`${styles.app} ${styles.phoneApp} ${onContinue ? styles.embedded : ''}`} data-check={section && !draft?.problemEditing && !receipt && !draft?.sent ? section.id : undefined}>
    <div className={styles.phoneShell}>
      {!context || !draft ? <section className={styles.phoneContent}><div className={styles.eyebrow}>FIVE POINT INSPECTION</div><h1>Morning inspection</h1><p>{error || "Connecting to OpsCenter…"}</p>{error && <button onClick={() => { setError(""); void load(); }}>Try again</button>}</section>
      : receipt ? <>
        <section className={styles.phoneContent}>
          <div className={styles.received}>✓ RECEIVED BY OPSCENTER</div><h1 ref={heading} tabIndex={-1}>Report received.</h1><p className={styles.intro}>Your morning inspection is recorded.</p>
          <div className={styles.decisionCard} data-status={receipt.status}><h2>{receipt.status === "stop" ? "! Do not operate" : receipt.status === "clear" ? "✓ No problems reported" : "Problem reported"}</h2><p>{receipt.status === "stop" ? "Keep the truck parked. Contact your supervisor about the reported condition." : receipt.status === "clear" ? "All five inspection sections were marked good." : "You marked the truck safe to operate. The problem is recorded for OpsCenter."}</p></div>
          <div className={styles.card}><h2>{truckDisplayText(receipt.truck)} · {receipt.inspector}</h2><p>Received {new Date(receipt.receivedAt).toLocaleString()}</p><p className={styles.muted}>{Number(receipt.odometer).toLocaleString()} miles<br />Truck fullness: {receipt.loadLevel || "Not recorded"} · Fuel tank: {receipt.fuel}<br />5 checks · {receipt.answers.filter(a => a.status === "problem").length} problems · {receipt.photos.length} photos</p></div>
          {showReport && <section className={styles.card} aria-label="Submitted report">{reportBody(receipt)}</section>}
          {errors}
        </section>
        <div className={styles.actionBar}><button aria-expanded={showReport} onClick={() => setShowReport(!showReport)}>{showReport ? "Hide submitted report" : "View submitted report"}</button><p className={styles.muted}>{onContinue ? receipt.status === "stop" ? "Assignments are locked. Contact your manager before operating this truck." : "Inspection complete. Your assignments are ready." : "You can close this app."}</p>{onContinue ? receipt.status !== "stop" && <button className={styles.primary} onClick={onContinue}>Continue to Assignments →</button> : <button className={styles.backButton} onClick={() => { setReceipt(null); setShowReport(false); setDraft(emptyDraft()); }}>Start another inspection</button>}</div>
      </> : draft.sent ? <>
        <section className={styles.phoneContent}>
          <div className={styles.eyebrow}>AWAITING OPSCENTER</div><h1 ref={heading} tabIndex={-1}>{busy ? "Sending your report…" : "Receipt not confirmed."}</h1>
          <p className={styles.intro}>We haven’t confirmed a receipt from OpsCenter. Keep this phone open and check your connection.</p>
          <div className={styles.card}><h2>{truckDisplayText(draft.truck)} · Inspection</h2><p>5 checks completed<br />{draft.inspector} · {Number(draft.odometer).toLocaleString()} miles</p><p className={styles.muted}>Your answers are kept with this report.</p></div>
          {draft.status === "stop" && <div className={styles.decisionCard} data-status="stop"><h2>! Do not operate</h2><p>The reported condition still applies. Contact your supervisor.</p></div>}{errors}
        </section>
        <div className={styles.actionBar}><button className={styles.primary} disabled={busy} onClick={() => void checkResult()}>Check saved result</button><button disabled={busy} onClick={() => void submit()}>Send same report</button><p className={styles.muted}>Use this report. No need to start again.</p>{saveStatus}</div>
      </> : <>
        <section className={styles.phoneContent}>
          {!online && <p className={styles.offline}>No connection. Continue checking the truck; reconnect to send.</p>}
          {draft.step === 0 ? <>
            <div className={styles.eyebrow}>{inspectionDate(new Date(draft.startedAt))} · {truckDisplayText(draft.truck)}</div><h1 ref={heading} tabIndex={-1}>Morning, crew.</h1><p className={styles.intro}>Complete your truck’s five-point check before the day begins.</p>
            <form id="start-inspection" onSubmit={e => { e.preventDefault(); if (context.trucks.includes(draft.truck) && draft.inspector.trim() && /^\d{1,8}$/.test(draft.odometer)) change({ step: 1, startedAt: new Date().toISOString() }); }}>
              <label className={styles.inputCard}>Truck for this inspection<select disabled={apiPath !== "/api/truck-inspection"} required value={draft.truck} onChange={e => chooseTruck(e.target.value)}><option value="">Choose truck</option>{context.trucks.map(t => <option key={t} value={t}>{truckDisplayText(t)}</option>)}</select></label>
              <label className={styles.inputCard}>Your name<input list="inspection-crew" value={draft.inspector} onChange={e => change({ inspector: e.target.value })} required maxLength={100} autoComplete="off" placeholder="Your name or initials" /></label><datalist id="inspection-crew">{context.inspectors.map(name => <option key={name} value={name} />)}</datalist>
              <label className={styles.inputCard}>Odometer · miles<input inputMode="numeric" pattern="[0-9]{1,8}" value={draft.odometer} onChange={e => change({ odometer: e.target.value })} required maxLength={8} placeholder="Enter the mileage" /></label>
            </form><p className={styles.muted}>{apiPath !== "/api/truck-inspection" ? "Inspect the truck selected during today’s setup." : "Choose the truck you are inspecting today. Any company phone can be used for any truck."}</p>
          </> : section ? <>
            <div className={styles.checkHeading}><h1 ref={heading} tabIndex={-1}>{draft.problemEditing ? "What needs attention?" : section.label}</h1><span className={styles.eyebrow}>{draft.step} of 5</span></div>
            <div className={styles.progress} aria-label={`Check ${draft.step} of 5`}>{INSPECTION_SECTIONS.map((s, i) => <span key={s.id} data-current={i + 1 === draft.step} data-result={draft.answers.find(a => a.id === s.id)?.status || ""} />)}</div>
            {draft.problemEditing && <p className={styles.intro}>Tell OpsCenter what you found during {section.label.toLowerCase()}. Add a photo of the problem to continue.</p>}
            {!draft.problemEditing ? <ol className={styles.checks}>{section.checks.map(check => <li key={check}>{check}</li>)}</ol> : <>
              <label className={styles.inputCard}>What did you find?<textarea required maxLength={1000} value={answer?.notes || ""} placeholder="Include the location and what looks wrong." onChange={e => change({ answers: draft.answers.map(a => a.id === section.id ? { ...a, notes: e.target.value } : a) })} /></label>
              <label className={styles.photoButton}>＋ Take or add a photo<input type="file" accept="image/*" capture="environment" disabled={busy || draft.photos.length >= 5 || sectionHasPhoto} onChange={e => { void addPhoto(e.target.files?.[0], section.id); e.target.value = ""; }} /></label><p className={styles.muted}>Required · One photo for this section</p>
              <div className={styles.photos}>{draft.photos.map((p, index) => p.section === section.id && <figure key={index}><img src={p.data} alt={`${section.label} problem photo`} /><button aria-label={`Remove photo ${index + 1}`} disabled={busy} onClick={() => change({ photos: draft.photos.filter((_, i) => i !== index) })}>Remove</button></figure>)}</div>
            </>}
            {section.id === "dashboard" && <fieldset className={styles.fuel}><legend>Fuel tank level <span>· required</span></legend><div>{INSPECTION_LEVELS.map((f, i) => <button type="button" key={f} aria-label={`Fuel tank ${f}`} aria-pressed={draft.fuel === f} onClick={() => change({ fuel: f })}>{["Empty", "¼", "½", "¾", "Full"][i]}</button>)}</div></fieldset>}
            {section.id === "operation" && <fieldset className={styles.fuel}><legend>Truck fullness <span>· cargo space filled</span></legend><div>{INSPECTION_LEVELS.map((level, i) => <button type="button" key={level} aria-label={truckDisplayText(`Truck fullness ${level}`)} aria-pressed={draft.loadLevel === level} onClick={() => change({ loadLevel: level })}>{["Empty", "¼", "½", "¾", "Full"][i]}</button>)}</div></fieldset>}

          </> : draft.step === 7 ? <>
            <div className={styles.eyebrow}>FINAL OPERATING STATUS</div><h1 ref={heading} tabIndex={-1}>Can this truck operate?</h1><p className={styles.intro}>Choose based on the inspection. Your choice is included in the report.</p>
            <fieldset className={styles.statusChoices}><legend className={styles.srOnly}>Final operating status</legend>{Object.entries(INSPECTION_STATUSES).map(([value, label]) => <label className={styles.radio} key={value}><input type="radio" name="final-status" value={value} checked={draft.status === value} disabled={(value === "clear" && problemCount > 0) || (value === "reported" && !problemCount)} onChange={() => change({ status: value as InspectionStatus })} />{label}</label>)}</fieldset>
            <p className={styles.muted}>{problemCount ? "A problem was reported. No problems is unavailable." : "Choose Do not operate if the truck should stay parked."}</p>
            <label>Additional notes{draft.status === "stop" && !problemCount ? " · required" : " · optional"}<textarea maxLength={2000} value={draft.notes} onChange={e => change({ notes: e.target.value })} /></label>
            {draft.status === "stop" && !problemCount && !draft.photos.length && <><p className={styles.muted}>Add a photo showing why the truck must not operate.</p><label className={styles.photoButton}>＋ Take or add a photo<input type="file" accept="image/*" capture="environment" disabled={busy} onChange={e => { void addPhoto(e.target.files?.[0], "walk-around"); e.target.value = ""; }} /></label></>}
            {draft.status === "stop" && !problemCount && <div className={styles.photos}>{draft.photos.map((p, index) => <figure key={index}><img src={p.data} alt="Do not operate photo" /><button aria-label={`Remove photo ${index + 1}`} disabled={busy} onClick={() => change({ photos: draft.photos.filter((_, i) => i !== index) })}>Remove</button></figure>)}</div>}
          </> : <>
            <div className={styles.eyebrow}>{complete ? "ALL 5 CHECKS COMPLETE" : "COMPLETE EVERY CHECK"}</div><h1 ref={heading} tabIndex={-1}>Review & send.</h1><p className={styles.intro}>{truckDisplayText(draft.truck)} · {draft.inspector}<br />{Number(draft.odometer).toLocaleString()} miles<br />Truck fullness: {draft.loadLevel || "not selected"} · Fuel tank: {draft.fuel || "not selected"}</p>
            <div className={styles.card}>{INSPECTION_SECTIONS.map((s, i) => { const a = draft.answers.find(a => a.id === s.id); return <div className={styles.reviewRow} key={s.id}><div><strong>{s.label}</strong><p data-status={a?.status === "problem" ? "reported" : "clear"}>{a?.status === "good" ? "✓ Good" : `! ${a?.notes || "Not checked"}`}</p></div><button aria-label={`Edit ${s.label}`} disabled={busy} onClick={() => change({ step: i + 1, returnToReview: true, problemEditing: false })}>Edit</button></div>; })}</div>
            {photoError && <p role="alert" className={styles.error}>{photoError} {problemCount ? "Use Edit to add the missing photo." : "Open Operating status to add the photo."}</p>}
            <button className={styles.statusSummary} data-status={draft.status} onClick={() => change({ step: 7 })}><span>OPERATING STATUS · CHANGE</span><strong>{draft.status ? INSPECTION_STATUSES[draft.status] : "Choose operating status"}</strong></button>
            {draft.notes && <p>{draft.notes}</p>}
            <label className={styles.inputCard}>Your initials<input maxLength={12} value={draft.initials} onChange={e => change({ initials: e.target.value })} autoComplete="off" placeholder="Initial here" /></label><p className={styles.muted}>By initialing, I confirm I performed these checks and recorded the conditions I found.</p>
            {draft.status === "stop" && <p className={styles.stop}>Do not operate the truck. Contact your supervisor.</p>}<p className={styles.muted}>{draft.photos.length} photo{draft.photos.length === 1 ? "" : "s"} included</p>
          </>}{errors}
        </section>
        <div className={`${styles.actionBar} ${section && !draft.problemEditing ? styles.checkActions : ""}`}>
          {draft.step === 0 ? <button form="start-inspection" className={styles.primary} disabled={!draft.truck}>Start inspection →</button>
          : section ? <>
            {draft.problemEditing ? <><button className={styles.primary} disabled={busy || !answer?.notes.trim() || !sectionHasPhoto || missingSectionLevel} onClick={e => nextSection(false, e.timeStamp)}>Save problem & continue →</button><button onClick={() => change({ problemEditing: false })} disabled={busy}>Back to {section.label.toLowerCase()}</button></>
            : <><button className={styles.goodButton} disabled={busy || missingSectionLevel} onClick={e => nextSection(true, e.timeStamp)}>✓ Good <span className={styles.srOnly}>— {draft.returnToReview ? "review" : draft.step === 5 ? "finish checks" : "next check"}</span><span aria-hidden="true">→</span></button><button disabled={busy} onClick={() => change({ problemEditing: true, answers: [...draft.answers.filter(a => a.id !== section.id), { id: section.id, status: "problem", notes: answer?.notes || "" }], status: "" })}>! Report a problem</button></>}
            <div className={styles.actionMeta}>{back(draft.returnToReview ? 6 : draft.step - 1)}{saveStatus}</div>
          </> : draft.step === 7 ? <><button className={styles.primary} disabled={busy || !draft.status || (draft.status === "stop" && !problemCount && (!draft.notes.trim() || !draft.photos.length))} onClick={() => change({ step: 6 })}>Review report →</button><div className={styles.actionMeta}>{back(complete ? 6 : 5)}{saveStatus}</div></>
          : <><button className={styles.primary} disabled={busy || !canSend} onClick={() => void submit()}>Send to OpsCenter</button><p className={styles.muted}>Wait for your receipt before closing.</p><div className={styles.actionMeta}>{back(7, "Operating status")}{saveStatus}</div></>}
        </div>
      </>}
    </div>
  </main>;
}
