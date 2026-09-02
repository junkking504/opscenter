"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";

type CreationMode = "editing" | "review" | "saving" | "verifying" | "duplicate" | "uncertain" | "verified";

type FormState = {
  franchise: string;
  date: string;
  startTime: string;
  durationHours: string;
  truck: string;
  appointmentType: "Job" | "Estimate";
  firstName: string;
  lastName: string;
  business: boolean;
  company: string;
  phone: string;
  email: string;
  howHeard: string;
  serviceAddress: string;
  serviceZip: string;
  serviceContactName: string;
  serviceContactPhone: string;
  billingSameAsService: boolean;
  billingAddress: string;
  billingZip: string;
  billingEmail: string;
  estimatedPickups: string;
  scope: string;
  notes: string;
  duplicateOverrideReason: string;
};

type CreationResult = {
  appointmentId: string;
  jkNumber: string;
  appointmentUrl: string;
  franchise: string;
  date: string;
  startTime: string;
  durationHours: number;
  truck: string;
  appointmentType: "Job" | "Estimate";
  customerMode: "existing" | "new";
  verifiedAt: string;
};

const FRANCHISES = ["New Orleans", "Jefferson Parish", "Northshore", "Baton Rouge"];
const HOW_HEARD = [
  "Returning",
  "Referral",
  "Google - Search",
  "Google - Ads",
  "Google - Local Service Ad",
  "Google - Maps",
  "Website",
  "Saw Trucks/Company Vehicle",
  "Yelp",
  "Thumbtack",
  "TV/Radio",
  "Online - Social",
  "Angi Leads",
  "Angi Ads",
  "National Account",
  "Neighborly",
  "Networking/Events",
  "Email/SMS",
  "ChatGPT",
  "Unknown",
];
const TIMES = Array.from({ length: 10 }, (_, index) => `${String(index + 8).padStart(2, "0")}:00`);
const PICKUP_LOADS = Array.from({ length: 12 }, (_, index) => (index + 1) / 2);

function todayInLouisiana(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Chicago",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function initialForm(selectedDate: string): FormState {
  const today = todayInLouisiana();
  return {
    franchise: "New Orleans",
    date: selectedDate >= today ? selectedDate : today,
    startTime: "09:00",
    durationHours: "1",
    truck: "Truck 1",
    appointmentType: "Job",
    firstName: "",
    lastName: "",
    business: false,
    company: "",
    phone: "",
    email: "",
    howHeard: "",
    serviceAddress: "",
    serviceZip: "",
    serviceContactName: "",
    serviceContactPhone: "",
    billingSameAsService: true,
    billingAddress: "",
    billingZip: "",
    billingEmail: "",
    estimatedPickups: "1",
    scope: "",
    notes: "",
    duplicateOverrideReason: "",
  };
}

function timeLabel(value: string, durationHours: number): string {
  const hour = Number(value.slice(0, 2));
  const label = (hourValue: number) => {
    const normalizedHour = hourValue % 24;
    const period = normalizedHour >= 12 ? "PM" : "AM";
    const clockHour = normalizedHour % 12 || 12;
    return `${clockHour}:00 ${period}`;
  };
  return `${label(hour)}–${label(hour + durationHours)}`;
}

export default function AppointmentCreateDialog({ selectedDate }: { selectedDate: string }) {
  const closeButton = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<FormState>(() => initialForm(selectedDate));
  const [mode, setMode] = useState<CreationMode>("editing");
  const [error, setError] = useState("");
  const [requestId, setRequestId] = useState("");
  const [result, setResult] = useState<CreationResult | null>(null);
  const busy = mode === "saving" || mode === "verifying";
  const billingAddress = form.billingSameAsService ? form.serviceAddress : form.billingAddress;
  const billingZip = form.billingSameAsService ? form.serviceZip : form.billingZip;

  const reviewLines = useMemo(() => [
    ["Customer", `${form.firstName.trim()} ${form.lastName.trim()}`.trim()],
    ["Category", form.appointmentType],
    ["Schedule", `${form.date} · ${timeLabel(form.startTime, Number(form.durationHours))}`],
    ["Assignment", `${form.truck} · ${form.franchise}`],
    ["Service", `${form.serviceAddress.trim()}, ${form.serviceZip.trim()}`],
    ["Work", `${form.scope.trim()} · ${form.estimatedPickups} pickup load${Number(form.estimatedPickups) === 1 ? "" : "s"}`],
  ], [form]);

  useEffect(() => {
    if (!open) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !busy) setOpen(false);
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [busy, open]);

  function begin() {
    setForm(initialForm(selectedDate));
    setMode("editing");
    setError("");
    setRequestId("");
    setResult(null);
    setOpen(true);
    window.requestAnimationFrame(() => closeButton.current?.focus());
  }

  function update<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((current) => ({ ...current, [key]: value }));
    if (mode !== "editing" && mode !== "duplicate") setMode("editing");
    setError("");
    setRequestId("");
    setResult(null);
  }

  function validate(): string {
    if (!form.firstName.trim() || !form.lastName.trim()) return "Enter the customer’s first and last name.";
    if (form.business && !form.company.trim()) return "Enter the company name for this business customer.";
    if (form.phone.replace(/\D/g, "").replace(/^1(?=\d{10}$)/, "").length !== 10) return "Enter a 10-digit customer phone number.";
    if (!form.howHeard) return "Choose how the customer heard about Junk King.";
    if (!form.serviceAddress.trim() || !/^\d{5}(?:-\d{4})?$/.test(form.serviceZip.trim())) return "Enter the service street address and ZIP code.";
    if (!billingAddress.trim() || !/^\d{5}(?:-\d{4})?$/.test(billingZip.trim())) return "Enter the billing street address and ZIP code.";
    if (!form.scope.trim()) return "Describe the work for this appointment.";
    if (mode === "duplicate" && form.duplicateOverrideReason.trim().length < 10) return "Enter why this appointment should be created despite the duplicate match.";
    return "";
  }

  function review() {
    const detail = validate();
    if (detail) {
      setError(detail);
      return;
    }
    setError("");
    setRequestId(crypto.randomUUID());
    setMode("review");
  }

  async function createAppointment() {
    if (mode !== "review" || busy) return;
    const currentRequestId = requestId || crypto.randomUUID();
    setRequestId(currentRequestId);
    setMode("saving");
    setError("");
    const verificationTimer = window.setTimeout(() => setMode("verifying"), 900);
    try {
      const response = await fetch("/api/appointments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          requestId: currentRequestId,
          franchise: form.franchise,
          date: form.date,
          startTime: form.startTime,
          durationHours: Number(form.durationHours),
          truck: form.truck,
          appointmentType: form.appointmentType,
          firstName: form.firstName,
          lastName: form.lastName,
          business: form.business,
          company: form.company,
          phone: form.phone,
          email: form.email,
          billingAddress,
          billingZip,
          billingEmail: form.billingEmail,
          howHeard: form.howHeard,
          serviceAddress: form.serviceAddress,
          serviceZip: form.serviceZip,
          serviceContactName: form.serviceContactName,
          serviceContactPhone: form.serviceContactPhone,
          estimatedPickups: Number(form.estimatedPickups),
          scope: form.scope,
          notes: form.notes,
          duplicateOverrideReason: form.duplicateOverrideReason,
        }),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok || !payload?.ok || !payload?.result?.jkNumber) {
        const detail = payload?.error || "JunkWare could not create the appointment.";
        if (payload?.code === "duplicate_appointment") {
          setMode("duplicate");
          setRequestId("");
        } else if (payload?.uncertain) {
          setMode("uncertain");
        } else {
          setMode("editing");
          setRequestId("");
        }
        throw new Error(detail);
      }
      setResult(payload.result as CreationResult);
      setMode("verified");
    } catch (creationError) {
      setError(creationError instanceof Error ? creationError.message : "JunkWare could not create the appointment.");
    } finally {
      window.clearTimeout(verificationTimer);
    }
  }

  return (
    <>
      <button type="button" className="ops-appointment-create-trigger" onClick={begin}>
        <span aria-hidden="true">＋</span> New Appointment
      </button>
      {open && typeof document !== "undefined" ? createPortal(
        <div
          className="ops-appointment-create-backdrop"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget && !busy) setOpen(false);
          }}
        >
          <aside className="ops-appointment-create-drawer" role="dialog" aria-modal="true" aria-labelledby="ops-new-appointment-title">
            <header className="ops-appointment-create-header">
              <div>
                <span>JunkWare-Governed Booking</span>
                <h2 id="ops-new-appointment-title">New Appointment</h2>
                <p>The JK number appears only after JunkWare saves and OpsCenter reads the appointment back.</p>
              </div>
              <button ref={closeButton} type="button" aria-label="Close new appointment" disabled={busy} onClick={() => setOpen(false)}>×</button>
            </header>

            <div className="ops-appointment-create-body">
              {mode === "verified" && result ? (
                <section className="ops-appointment-create-confirmed" aria-live="polite">
                  <span>Created and Verified in JunkWare</span>
                  <strong>{result.jkNumber}</strong>
                  <p>{result.appointmentType} · {result.date} · {timeLabel(result.startTime, result.durationHours)} · {result.truck}</p>
                  <div>
                    <span>Customer</span><strong>{result.customerMode === "existing" ? "Matched to existing customer" : "New customer record"}</strong>
                    <span>Read-back</span><strong>JK number, customer, address, date, time, category, franchise, and truck match</strong>
                    <span>Schedule</span><strong>Appears after the next JunkWare source refresh</strong>
                  </div>
                </section>
              ) : busy ? (
                <section className="ops-appointment-create-progress" aria-live="polite">
                  <header><span>JunkWare Creation Status</span><strong>{mode === "saving" ? "Creating Appointment" : "Verifying JK Number"}</strong></header>
                  <div className="ops-appointment-create-steps">
                    <article className="active"><i>1</i><div><strong>Create</strong><span>Save the reviewed appointment in JunkWare</span></div></article>
                    <article className={mode === "verifying" ? "active" : ""}><i>2</i><div><strong>Verify</strong><span>Read the exact appointment back</span></div></article>
                    <article><i>3</i><div><strong>Confirm</strong><span>Show the assigned JK number</span></div></article>
                  </div>
                  <p>{mode === "saving" ? "Do not close or submit another appointment while JunkWare is saving." : "OpsCenter is matching the returned record to the reviewed customer, address, date, time, category, franchise, and truck."}</p>
                </section>
              ) : (
                <>
                  <section className="ops-appointment-create-section">
                    <header><span>Customer</span><strong>Who is booking?</strong></header>
                    <div className="ops-appointment-create-grid">
                      <label><span>First Name</span><input name="firstName" autoComplete="given-name" value={form.firstName} onChange={(event) => update("firstName", event.target.value)} /></label>
                      <label><span>Last Name</span><input name="lastName" autoComplete="family-name" value={form.lastName} onChange={(event) => update("lastName", event.target.value)} /></label>
                      <label><span>Customer Type</span><select name="business" value={form.business ? "business" : "residential"} onChange={(event) => update("business", event.target.value === "business")}><option value="residential">Residential</option><option value="business">Business</option></select></label>
                      {form.business ? <label><span>Company</span><input name="company" autoComplete="organization" value={form.company} onChange={(event) => update("company", event.target.value)} /></label> : null}
                      <label><span>Phone</span><input name="phone" inputMode="tel" autoComplete="tel" placeholder="(504) 555-0123" value={form.phone} onChange={(event) => update("phone", event.target.value)} /></label>
                      <label><span>Email <em>Optional</em></span><input name="email" type="email" autoComplete="email" value={form.email} onChange={(event) => update("email", event.target.value)} /></label>
                      <label><span>How Heard</span><select name="howHeard" value={form.howHeard} onChange={(event) => update("howHeard", event.target.value)}><option value="" disabled>Select source</option>{HOW_HEARD.map((source) => <option key={source}>{source}</option>)}</select></label>
                    </div>
                    <p className="ops-appointment-create-help">OpsCenter searches JunkWare by name and phone before it creates a new customer record.</p>
                  </section>

                  <section className="ops-appointment-create-section">
                    <header><span>Service</span><strong>Where and what?</strong></header>
                    <div className="ops-appointment-create-grid">
                      <label className="wide"><span>Service Street Address</span><input name="serviceAddress" autoComplete="street-address" placeholder="Street address" value={form.serviceAddress} onChange={(event) => update("serviceAddress", event.target.value)} /></label>
                      <label><span>Service ZIP</span><input name="serviceZip" inputMode="numeric" autoComplete="postal-code" value={form.serviceZip} onChange={(event) => update("serviceZip", event.target.value)} /></label>
                      <label><span>Service Contact <em>Optional</em></span><input name="serviceContactName" value={form.serviceContactName} onChange={(event) => update("serviceContactName", event.target.value)} /></label>
                      <label><span>Contact Phone <em>Optional</em></span><input name="serviceContactPhone" inputMode="tel" value={form.serviceContactPhone} onChange={(event) => update("serviceContactPhone", event.target.value)} /></label>
                      <label className="wide"><span>Work Description</span><input name="scope" placeholder="Items, removal scope, or estimate request" value={form.scope} onChange={(event) => update("scope", event.target.value)} /></label>
                      <label><span>Estimated Volume</span><select name="estimatedPickups" value={form.estimatedPickups} onChange={(event) => update("estimatedPickups", event.target.value)}>{PICKUP_LOADS.map((load) => <option value={load} key={load}>{load} pickup load{load === 1 ? "" : "s"}</option>)}</select></label>
                    </div>
                  </section>

                  <section className="ops-appointment-create-section">
                    <header><span>Schedule</span><strong>When and with which truck?</strong></header>
                    <div className="ops-appointment-create-grid">
                      <label><span>Franchise</span><select name="franchise" value={form.franchise} onChange={(event) => update("franchise", event.target.value)}>{FRANCHISES.map((franchise) => <option key={franchise}>{franchise}</option>)}</select></label>
                      <label><span>Category</span><select name="appointmentType" value={form.appointmentType} onChange={(event) => update("appointmentType", event.target.value as FormState["appointmentType"])}><option>Job</option><option>Estimate</option></select></label>
                      <label><span>Date</span><input name="date" type="date" min={todayInLouisiana()} value={form.date} onChange={(event) => update("date", event.target.value)} /></label>
                      <label><span>Start Time</span><select name="startTime" value={form.startTime} onChange={(event) => update("startTime", event.target.value)}>{TIMES.map((time) => <option value={time} key={time}>{timeLabel(time, 1).split("–")[0]}</option>)}</select></label>
                      <label><span>Duration</span><select name="durationHours" value={form.durationHours} onChange={(event) => update("durationHours", event.target.value)}>{Array.from({ length: 12 }, (_, index) => index + 1).map((hours) => <option value={hours} key={hours}>{hours} hour{hours === 1 ? "" : "s"}</option>)}</select></label>
                      <label><span>Truck</span><select name="truck" value={form.truck} onChange={(event) => update("truck", event.target.value)}>{Array.from({ length: 9 }, (_, index) => `Truck ${index + 1}`).map((truck) => <option key={truck}>{truck}</option>)}</select></label>
                    </div>
                    <p className="ops-appointment-create-help">JunkWare performs the final availability check. If the time or truck is no longer available, nothing is created.</p>
                  </section>

                  <section className="ops-appointment-create-section">
                    <header><span>Billing and Notes</span><strong>Required booking details</strong></header>
                    <label className="ops-appointment-create-checkbox"><input type="checkbox" checked={form.billingSameAsService} onChange={(event) => update("billingSameAsService", event.target.checked)} /><span>Billing address is the same as the service address</span></label>
                    {!form.billingSameAsService ? <div className="ops-appointment-create-grid"><label className="wide"><span>Billing Street Address</span><input name="billingAddress" value={form.billingAddress} onChange={(event) => update("billingAddress", event.target.value)} /></label><label><span>Billing ZIP</span><input name="billingZip" inputMode="numeric" value={form.billingZip} onChange={(event) => update("billingZip", event.target.value)} /></label></div> : null}
                    <div className="ops-appointment-create-grid">
                      <label><span>Billing Email <em>Optional</em></span><input name="billingEmail" type="email" value={form.billingEmail} onChange={(event) => update("billingEmail", event.target.value)} /></label>
                      <label className="wide"><span>Appointment Notes <em>Optional</em></span><textarea name="notes" rows={3} value={form.notes} onChange={(event) => update("notes", event.target.value)} /></label>
                    </div>
                  </section>

                  {mode === "duplicate" ? (
                    <section className="ops-appointment-create-warning">
                      <strong>Possible Duplicate Blocked</strong>
                      <p>{error}</p>
                      <label><span>Reason to Create Another Appointment</span><textarea name="duplicateOverrideReason" rows={3} value={form.duplicateOverrideReason} onChange={(event) => update("duplicateOverrideReason", event.target.value)} /></label>
                    </section>
                  ) : null}

                  {mode === "uncertain" ? (
                    <section className="ops-appointment-create-warning is-uncertain">
                      <strong>Do Not Retry Yet</strong>
                      <p>The JunkWare save may have completed, but the read-back was inconclusive. Search JunkWare using the same date, phone, service address, and time before starting another request.</p>
                    </section>
                  ) : null}

                  {mode === "review" ? (
                    <section className="ops-appointment-create-review">
                      <header><span>Final Review</span><strong>Ready to Create in JunkWare</strong></header>
                      <div>{reviewLines.map(([label, value]) => <p key={label}><span>{label}</span><strong>{value}</strong></p>)}</div>
                      <footer>JunkWare assigns the JK number. OpsCenter will not report success until the saved record matches this review.</footer>
                    </section>
                  ) : null}

                  {error && mode !== "duplicate" ? <p className="ops-appointment-create-error" role="alert">{error}</p> : null}
                </>
              )}
            </div>

            <footer className="ops-appointment-create-actions">
              {mode === "verified" && result ? (
                <>
                  <button type="button" onClick={() => setOpen(false)}>Close</button>
                  <a href={result.appointmentUrl} target="_blank" rel="noreferrer">Open in JunkWare ↗</a>
                  <a className="primary" href={`/jobs?date=${encodeURIComponent(result.date)}&q=${encodeURIComponent(result.jkNumber)}`}>Refresh Schedule →</a>
                </>
              ) : mode === "uncertain" ? (
                <>
                  <button type="button" onClick={() => setOpen(false)}>Close</button>
                  <a href="https://junkware.junk-king.com/franchise/schedule.aspx" target="_blank" rel="noreferrer">Search JunkWare ↗</a>
                </>
              ) : (
                <>
                  <button type="button" disabled={busy} onClick={() => setOpen(false)}>Cancel</button>
                  {mode === "review" ? <button type="button" disabled={busy} className="primary" onClick={() => void createAppointment()}>Create in JunkWare →</button> : <button type="button" disabled={busy} className="primary" onClick={review}>{busy ? "Working…" : mode === "duplicate" ? "Review with Reason →" : "Review Appointment →"}</button>}
                </>
              )}
            </footer>
          </aside>
        </div>,
        document.body,
      ) : null}
    </>
  );
}
