"use client";

import { paymentReferenceLabel, validateCloseoutPayment } from "../lib/closeout-payment";

import { useEffect, useId, useRef, useState } from "react";
import type { ScheduleAppointment } from './lib/schedule-contract';
import { sendScheduleChange, checkScheduleChange, ChangeReceipt, type Receipt } from './schedule-controls';
import './appointment-closeout.css';

type Option = { value: string; label: string };
type OtherCharge = { label: string; quantity: string; price: string; total: string };
type PendingOtherCharge = OtherCharge & { clientId: string; typeValue: string };
type LiveCloseout = {
  truck?: string;
  appointmentType?: { value: string; label: string; options: Option[] };
  status: { value: string; label: string };
  driver: Option;
  drivers: Option[];
  navigators: Option[];
  navigatorOptions: Option[];
  loadQuantity: string;
  loadSize: { value: string; label: string; options: Option[] };
  loadPrices: number[];
  loadPrice: string;
  bedloadQuantity: string;
  bedloadSize: { value: string; label: string; options: Option[] };
  bedloadPrices: number[];
  bedloadPrice: string;
  otherChargeOptions: Option[];
  otherCharges: OtherCharge[];
  discount: string;
  tip: string;
  howHeard?: { value: string; label: string; options: Option[] };
  jobCategory: { value: string; label: string; options: Option[] };
  actualStartHour: { value: string; label: string; options: Option[] };
  actualStartMinute: { value: string; label: string; options: Option[] };
  actualEndHour: { value: string; label: string; options: Option[] };
  actualEndMinute: { value: string; label: string; options: Option[] };
  paymentMethods: Option[];
  payments: Array<{ description: string; amount: string }>;
  balance: string;
  total: string;
};

function inputMoney(value: string): string {
  return String(value || "").replace(/[^0-9.-]/g, "");
}

function automaticSizePrice(size: string, quantity: string, options: Option[], prices: number[], kind: 'load' | 'bedload'): string {
  const index = options.findIndex((option) => option.value === size);
  if (index <= 0 || !prices.length) return '';
  const units = Number.parseInt(quantity, 10);
  const countedUnits = Number.isFinite(units) && units > 0 ? units : 0;
  let price = countedUnits * prices.at(-1)!;
  if (kind === 'load' && size === 'Bag(s)' && countedUnits) price = countedUnits * prices[0];
  else if (size !== 'Bag(s)') price += prices[index - 1] || 0;
  return price > 0 ? price.toFixed(2) : '';
}

export default function AppointmentCloseout({ job, date: serviceDate, saved, onBusyChange }: { job: ScheduleAppointment; date: string; saved: () => void; onBusyChange: (busy: boolean) => void }) {
  const { appointmentId, appointmentUrl, status: initialStatus } = job;
  const paymentGroupId = useId();
  const [sourceVersion, setSourceVersion] = useState('');
  const [canWrite, setCanWrite] = useState(false);
  const [receipt, setReceipt] = useState<Receipt | null>(null);
  const [reviewing, setReviewing] = useState(false);
  const [category, setCategory] = useState(job.appointmentType.toLowerCase().includes('estimate') ? 'Estimate' : 'Job');
  const [estimateReason, setEstimateReason] = useState('');
  const [estimateExplanation, setEstimateExplanation] = useState('');
  const [noDiscountReason, setNoDiscountReason] = useState('');
  const requestPending = useRef(false);
  const resolvedAppointmentId = appointmentId || String(appointmentUrl || "").match(/[?&]id=(\d{1,12})(?:&|$)/i)?.[1] || "";
  const [live, setLive] = useState<LiveCloseout | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [addPayment, setAddPayment] = useState(false);
  const [paymentMethod, setPaymentMethod] = useState("");
  const [paymentAmount, setPaymentAmount] = useState("");
  const [paymentReference, setPaymentReference] = useState("");
  const [otherChargeType, setOtherChargeType] = useState("");
  const [otherChargeQuantity, setOtherChargeQuantity] = useState("1");
  const [otherChargePrice, setOtherChargePrice] = useState("");
  const [pendingOtherCharges, setPendingOtherCharges] = useState<PendingOtherCharge[]>([]);
  const otherChargePriceIsAutomatic = otherChargeType.split("|")[2] === "1";

  useEffect(() => { onBusyChange(loading || saving); return () => onBusyChange(false); }, [loading, saving, onBusyChange]);
  if (/cancel(?:ed|led)/i.test(initialStatus)) return null;

  async function load(reconciled = false) {
    if (!reconciled && receipt && ['pending', 'uncertain'].includes(receipt.status)) return;
    if (!resolvedAppointmentId) {
      setError("This job does not have a Junkware appointment link yet.");
      return;
    }
    setLoading(true);
    setError("");
    setMessage("");
    try {
      const response = await fetch(`/api/desktop/schedule/closeout?appointmentId=${encodeURIComponent(resolvedAppointmentId)}`, { cache: "no-store" });
      const payload = await response.json().catch(() => { throw new Error(`Closeout could not be loaded (HTTP ${response.status}). Retry loading the saved appointment.`); });
      if (!response.ok || !payload?.closeout) throw new Error(payload?.error || "The Junkware closeout could not be loaded.");
      setLive(payload.closeout);
      setAddPayment(false);
      setPaymentMethod("");
      setPaymentAmount("");
      setPaymentReference("");
      setCategory(payload.closeout.appointmentType?.label === 'Estimate' ? 'Estimate' : 'Job');
      setSourceVersion(payload.sourceVersion || '');
      setCanWrite(payload.canWrite === true);
      setEstimateReason('');
      setEstimateExplanation('');
      setNoDiscountReason('');
      setReceipt(payload.pendingReceipt || null);
      setReviewing(false);
      setPendingOtherCharges([]);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "The Junkware closeout could not be loaded.");
    } finally {
      setLoading(false);
    }
  }

  function update<K extends keyof LiveCloseout>(key: K, value: LiveCloseout[K]) {
    setReviewing(false);
    setLive((current) => current ? { ...current, [key]: value } : current);
  }

  function updateSelect(key: "loadSize" | "bedloadSize" | "jobCategory" | "actualStartHour" | "actualStartMinute" | "actualEndHour" | "actualEndMinute", value: string) {
    setReviewing(false);
    setLive((current) => current ? { ...current, [key]: { ...current[key], value } } : current);
  }

  function updateLoadSize(value: string) {
    setReviewing(false);
    setLive((current) => current ? { ...current, loadSize: { ...current.loadSize, value }, loadPrice: automaticSizePrice(value, current.loadQuantity, current.loadSize.options, current.loadPrices, 'load') } : current);
  }

  function updateLoadQuantity(value: string) {
    setReviewing(false);
    setLive((current) => current ? { ...current, loadQuantity: value, loadPrice: automaticSizePrice(current.loadSize.value, value, current.loadSize.options, current.loadPrices, 'load') } : current);
  }

  function updateBedloadSize(value: string) {
    setReviewing(false);
    setLive((current) => current ? { ...current, bedloadSize: { ...current.bedloadSize, value }, bedloadPrice: automaticSizePrice(value, current.bedloadQuantity, current.bedloadSize.options, current.bedloadPrices, 'bedload') } : current);
  }

  function updateBedloadQuantity(value: string) {
    setReviewing(false);
    setLive((current) => current ? { ...current, bedloadQuantity: value, bedloadPrice: automaticSizePrice(current.bedloadSize.value, value, current.bedloadSize.options, current.bedloadPrices, 'bedload') } : current);
  }

  function setNavigator(index: number, value: string) {
    if (!live) return;
    const navigators = live.navigators.map((row, rowIndex) => rowIndex === index
      ? { value, label: live.navigatorOptions.find((option) => option.value === value)?.label || "" }
      : row);
    update("navigators", navigators);
  }

  function addNavigator() {
    if (!live) return;
    update("navigators", [...live.navigators, { value: "", label: "" }]);
  }

  function removeNavigator(index: number) {
    if (!live) return;
    update("navigators", live.navigators.filter((_, rowIndex) => rowIndex !== index));
  }

  function selectOtherCharge(value: string) {
    setOtherChargeType(value);
    setOtherChargePrice(value.split("|")[2] === "1" ? "" : value.split("|")[1] || "");
  }

  function addOtherCharge() {
    if (!live) return;
    const option = live.otherChargeOptions.find((candidate) => candidate.value === otherChargeType);
    const isPercentage = option?.value.split("|")[2] === "1";
    if (!option || !otherChargeQuantity.trim() || (!isPercentage && !inputMoney(otherChargePrice))) {
      setError("Choose an Other Charge and enter its quantity and price.");
      return;
    }
    setReviewing(false);
    setPendingOtherCharges((current) => [...current, {
      clientId: `${Date.now()}-${current.length}`,
      typeValue: option.value,
      label: option.label,
      quantity: otherChargeQuantity.trim(),
      price: inputMoney(otherChargePrice),
      total: "",
    }]);
    setOtherChargeType("");
    setOtherChargeQuantity("1");
    setOtherChargePrice("");
    setError("");
  }

  function removePendingOtherCharge(clientId: string) {
    setReviewing(false);
    setPendingOtherCharges((current) => current.filter((charge) => charge.clientId !== clientId));
  }

  async function save() {
    if (!live || !canWrite || requestPending.current || (receipt && receipt.status !== 'failed')) return;
    if (!live.truck) {
      setError('Assign a truck to this appointment before closing it, then reload from JunkWare.');
      return;
    }
    const navigatorIds = live.navigators.map((row) => row.value).filter(Boolean);
    if (!live.driver.value) {
      setError("Choose a driver before saving the closeout.");
      return;
    }
    if (new Set([live.driver.value, ...navigatorIds]).size !== 1 + navigatorIds.length) {
      setError("Each assigned person can only appear once on the job.");
      return;
    }
    if (![live.actualStartHour.value, live.actualStartMinute.value, live.actualEndHour.value, live.actualEndMinute.value].every(Boolean)) {
      setError('Enter actual start and finish times before reviewing the closeout.'); return;
    }
    if (live.howHeard && !live.howHeard.value) { setError('Choose how the customer heard about us.'); return; }
    if (!inputMoney(live.loadPrice) && !inputMoney(live.bedloadPrice)) { setError('Enter a load or bedload price.'); return; }
    if (addPayment) {
      const paymentError = validateCloseoutPayment({ methodId: paymentMethod, amount: inputMoney(paymentAmount), reference: paymentReference.trim() }, live.paymentMethods);
      if (paymentError) { setError(paymentError); return; }
    }
    const completingEstimate = category === 'Estimate' && live.status.value !== '8';
    const noDiscountRequired = completingEstimate && !(Number(inputMoney(live.discount)) > 0);
    if (completingEstimate && (!estimateReason || !estimateExplanation.trim())) {
      setError('Choose why this remained an estimate and add the outcome notes before closing it.');
      return;
    }
    if (noDiscountRequired && !noDiscountReason.trim()) {
      setError('Add why no discount was offered before closing this estimate.');
      return;
    }
    if (otherChargeType) { setError("Add the pending Other Charge or clear its selection before reviewing."); return; }
    if (!reviewing) { setError(""); setReviewing(true); return; }
    requestPending.current = true;
    setSaving(true);
    setError("");
    setMessage("");
    try {
      const requestId = crypto.randomUUID();
      const result = await sendScheduleChange(job, serviceDate, 'closeout', {
        ...{
          appointmentId: resolvedAppointmentId,
          serviceDate,
          driverId: live.driver.value,
          navigatorIds,
          loadQuantity: live.loadQuantity,
          loadSize: live.loadSize.value,
          loadPrice: inputMoney(live.loadPrice),
          bedloadQuantity: live.bedloadQuantity,
          bedloadSize: live.bedloadSize.value,
          bedloadPrice: inputMoney(live.bedloadPrice),
          otherChargesToAdd: pendingOtherCharges.map((charge) => ({
            typeValue: charge.typeValue,
            quantity: charge.quantity,
            price: inputMoney(charge.price),
          })),
          discount: inputMoney(live.discount),
          tip: inputMoney(live.tip),
          jobCategoryId: live.jobCategory.value,
          ...(live.howHeard ? { howHeardId: live.howHeard.value } : {}),
          actualStartHour: live.actualStartHour.value,
          actualStartMinute: live.actualStartMinute.value,
          actualEndHour: live.actualEndHour.value,
          actualEndMinute: live.actualEndMinute.value,
          addPayment: addPayment ? { methodId: paymentMethod, amount: inputMoney(paymentAmount), reference: paymentReference.trim() } : null,
        }, expectedSourceVersion: sourceVersion, appointmentType: category, ...(completingEstimate ? { estimateOutcome: {
          reason: estimateReason,
          explanation: estimateExplanation.trim(),
          ...(noDiscountRequired ? { noDiscountReason: noDiscountReason.trim() } : {}),
        } } : {}),
      }, requestId).catch(() => ({ requestId, status: 'uncertain', message: 'The closeout result could not be confirmed. Check Saved Result before another change.' } as Receipt));
      setReceipt(result);
      if (result.status !== 'verified' || !result.sourceResult?.closeout) return;
      const payload = result.sourceResult as { closeout: LiveCloseout; truckLoadStatus?: { updated?: boolean; status?: { truck?: string; currentLoadLabel?: string }; reason?: string } };
      setLive(payload.closeout);
      setAddPayment(false);
      setPaymentMethod("");
      setPaymentAmount("");
      setPendingOtherCharges([]);
      const loadStatus = payload.truckLoadStatus;
      setMessage(loadStatus?.updated && loadStatus?.status
        ? `Saved and verified in JunkWare. ${loadStatus.status.truck} is now ${loadStatus.status.currentLoadLabel}.`
        : `Saved and verified in JunkWare.${loadStatus?.reason ? ` Truck load status: ${loadStatus.reason}` : ""}`);
      saved();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Junkware did not save the closeout.");
    } finally {
      requestPending.current = false;
      setSaving(false);
    }
  }

  async function check() {
    if (!receipt || requestPending.current) return;
    requestPending.current = true; setSaving(true);
    try {
      const result = await checkScheduleChange(receipt.requestId);
      setReceipt(result);
      if (result.status === 'verified' || result.status === 'failed') {
        if (result.action && result.action !== 'closeout') {
          setReceipt(null); setLive(null); setSourceVersion(''); setCanWrite(false);
          await load(true);
        } else if (result.sourceResult?.closeout) setLive(result.sourceResult.closeout as LiveCloseout);
        setAddPayment(false); setPaymentMethod(''); setPaymentAmount(''); setPaymentReference(''); setPendingOtherCharges([]);
        saved();
      }
    }
    catch { setError('Saved result unavailable. Do not repeat this closeout.'); }
    finally { requestPending.current = false; setSaving(false); }
  }

  return (
    <details className="appointment-closeout-panel" data-appointment-id={resolvedAppointmentId} aria-busy={loading || saving} onToggle={event => { if (event.currentTarget.open && !live && !loading && !saving) void load(); }}>
      <summary>Appointment Closeout</summary>
      <div className="appointment-closeout-body">
        {receipt && <>{receipt.action && receipt.action !== 'closeout' && ['pending', 'uncertain'].includes(receipt.status) && <p role="alert">Closeout is locked until the earlier {receipt.action === 'move' ? 'assignment change' : 'appointment change'} is checked in JunkWare. This is not a closeout result.</p>}<ChangeReceipt receipt={receipt} onCheck={() => { void check(); }} /></>}
        {!live ? (
          loading ? <p role="status">Loading current JunkWare closeout…</p> : error ? (
            <button type="button" className="ops-button" onClick={() => void load()} disabled={!resolvedAppointmentId}>Retry loading closeout</button>
          ) : message ? <button type="button" className="ops-button" onClick={() => void load()} disabled={saving || !resolvedAppointmentId}>Reload from JunkWare</button> : null
        ) : (
          <>
            <fieldset onChange={() => setReviewing(false)} className="desktop-closeout-fields" disabled={saving || Boolean(receipt && receipt.status !== 'failed')}>
            <label><span>Final appointment category</span><select value={category} onChange={event => { setCategory(event.target.value); setReviewing(false); setEstimateReason(''); setEstimateExplanation(''); setNoDiscountReason(''); }}><option>Job</option><option>Estimate</option></select></label>
            <div className="drawer-facts">
              <div><span>Junkware status</span><strong>{live.status.label || "Unavailable"}</strong></div>
              <div><span>Saved total</span><strong>{live.total || "Unavailable"}</strong></div>
              <div><span>Balance</span><strong>{live.balance || "Unavailable"}</strong></div>
            </div>
            {saving ? <div className="ops-closeout-editor-message progress" role="status" aria-live="polite">Saving changes and checking them in JunkWare…</div> : null}

            {category === 'Estimate' && live.status.value !== '8' ? <section className="appointment-create-section estimate-outcome-fields">
              <h4>Estimate outcome required by JunkWare</h4>
              <label><span>Why did this remain an estimate?</span><select value={estimateReason} onChange={event => { setEstimateReason(event.target.value); setReviewing(false); }}><option value="">Select reason</option><option>Price/Budget</option><option>Date/Time</option><option>Other</option></select></label>
              <label><span>Outcome notes</span><textarea rows={2} maxLength={2000} value={estimateExplanation} onChange={event => { setEstimateExplanation(event.target.value); setReviewing(false); }} /></label>
              {!(Number(inputMoney(live.discount)) > 0) ? <label><span>Why was no discount offered?</span><textarea rows={2} maxLength={2000} value={noDiscountReason} onChange={event => { setNoDiscountReason(event.target.value); setReviewing(false); }} /></label> : null}
            </section> : null}

            <section className="appointment-create-section">
              <h4>Krewe Assigned to This Job</h4>
              <label>
                <span>Driver</span>
                <select value={live.driver.value} onChange={(event) => update("driver", { value: event.target.value, label: event.target.selectedOptions[0]?.text || "" })}>
                  {live.drivers.map((option) => <option key={`driver-${option.value}`} value={option.value}>{option.label || "Choose driver"}</option>)}
                </select>
              </label>
              <div className="ops-closeout-crew-list">
                {live.navigators.map((navigator, index) => (
                  <div className="ops-closeout-crew-row" key={`navigator-${index}`}>
                    <label>
                      <span>Navigator {index + 1}</span>
                      <select value={navigator.value} onChange={(event) => setNavigator(index, event.target.value)}>
                        {live.navigatorOptions.map((option) => <option key={`navigator-${index}-${option.value}`} value={option.value}>{option.label || "Choose navigator"}</option>)}
                      </select>
                    </label>
                    <button type="button" className="ops-button subtle" onClick={() => removeNavigator(index)}>Remove</button>
                  </div>
                ))}
              </div>
              <button type="button" className="ops-button subtle" onClick={addNavigator}>+ Add another navigator</button>
            </section>

            <section className="appointment-create-section">
              <h4>Job Charges</h4>
              <div className="appointment-closeout-grid">
                <label><span>Full trucks</span><input value={live.loadQuantity} inputMode="decimal" onChange={(event) => updateLoadQuantity(event.target.value)} /></label>
                <label><span>Load size</span><select value={live.loadSize.value} onChange={(event) => updateLoadSize(event.target.value)}>{live.loadSize.options.map((option) => <option key={`load-${option.value}`} value={option.value}>{option.label || "Full truck / none"}</option>)}</select></label>
                <p>For half a truck (3/6), enter 0 full trucks and select 3 (1/2). Enter the quoted load price before discount.</p>
                <label><span>Load price</span><input value={live.loadPrice} inputMode="decimal" onChange={(event) => update("loadPrice", event.target.value)} /></label>
                <label><span>Bedload quantity</span><input value={live.bedloadQuantity} inputMode="decimal" onChange={(event) => updateBedloadQuantity(event.target.value)} /></label>
                <label><span>Bedload size</span><select value={live.bedloadSize.value} onChange={(event) => updateBedloadSize(event.target.value)}>{live.bedloadSize.options.map((option) => <option key={`bed-${option.value}`} value={option.value}>{option.label || "None"}</option>)}</select></label>
                <label><span>Bedload price</span><input value={live.bedloadPrice} inputMode="decimal" onChange={(event) => update("bedloadPrice", event.target.value)} /></label>
                <label><span>Discount</span><input value={live.discount} inputMode="decimal" onChange={(event) => update("discount", event.target.value)} /></label>
                <label><span>Tip</span><input value={live.tip} inputMode="decimal" onChange={(event) => update("tip", event.target.value)} /></label>
                <label><span>Job category</span><select value={live.jobCategory.value} onChange={(event) => updateSelect("jobCategory", event.target.value)}>{live.jobCategory.options.map((option) => <option key={`category-${option.value}`} value={option.value}>{option.label || "Choose category"}</option>)}</select></label>
                {live.howHeard && <label><span>How heard</span><select value={live.howHeard.value} onChange={event => update("howHeard", { ...live.howHeard!, value: event.target.value })}>{live.howHeard.options.map(option => <option key={option.value} value={option.value}>{option.label || "Choose how heard"}</option>)}</select></label>}
              </div>
              <div className="ops-closeout-other-charges">
                <h5>Other Charges</h5>
                {live.otherCharges.length ? (
                  <div className="ops-closeout-charge-list" aria-label="Existing Other Charges">
                    {live.otherCharges.map((charge, index) => (
                      <div key={`existing-charge-${index}`}>
                        <span>{charge.label}</span>
                        <span>{charge.quantity ? `${charge.quantity} × ${charge.price}` : charge.price}</span>
                        <strong>{charge.total}</strong>
                      </div>
                    ))}
                  </div>
                ) : null}
                {pendingOtherCharges.length ? (
                  <div className="ops-closeout-charge-list pending" aria-label="Other Charges to add">
                    {pendingOtherCharges.map((charge) => (
                      <div key={charge.clientId}>
                        <span><small>To add</small>{charge.label}</span>
                        <span>{charge.typeValue.split("|")[2] === "1" ? `${charge.typeValue.split("|")[1]}% of job total` : `${charge.quantity} × $${charge.price}`}</span>
                        <button type="button" className="ops-closeout-text-button" onClick={() => removePendingOtherCharge(charge.clientId)}>Remove</button>
                      </div>
                    ))}
                  </div>
                ) : null}
                <div className="ops-closeout-charge-entry">
                  <label>
                    <span>Other charge</span>
                    <select value={otherChargeType} onChange={(event) => selectOtherCharge(event.target.value)}>
                      {live.otherChargeOptions.map((option) => <option key={`other-charge-${option.value}`} value={option.value}>{option.label || "Choose charge"}</option>)}
                    </select>
                  </label>
                  <label><span>Qty</span><input value={otherChargeQuantity} inputMode="decimal" onChange={(event) => setOtherChargeQuantity(event.target.value)} /></label>
                  <label className={otherChargePriceIsAutomatic ? "is-disabled" : ""}><span>Price / amount</span><input value={otherChargePrice} inputMode="decimal" placeholder={otherChargePriceIsAutomatic ? `${otherChargeType.split("|")[1]}% auto` : ""} disabled={otherChargePriceIsAutomatic} onChange={(event) => setOtherChargePrice(event.target.value)} /></label>
                  <button type="button" className="ops-button subtle" onClick={addOtherCharge}>+ Add charge</button>
                </div>
              </div>
            </section>

            <section className="appointment-create-section">
              <h4>Actual Job Time</h4>
              <div className="ops-closeout-time-grid">
                <span>Started</span>
                <select aria-label="Actual start hour" value={live.actualStartHour.value} onChange={(event) => updateSelect("actualStartHour", event.target.value)}>{live.actualStartHour.options.map((option) => <option key={`sh-${option.value}`} value={option.value}>{option.label || "Hour"}</option>)}</select>
                <select aria-label="Actual start minute" value={live.actualStartMinute.value} onChange={(event) => updateSelect("actualStartMinute", event.target.value)}>{live.actualStartMinute.options.map((option) => <option key={`sm-${option.value}`} value={option.value}>{option.label || "Minute"}</option>)}</select>
                <span>Finished</span>
                <select aria-label="Actual finish hour" value={live.actualEndHour.value} onChange={(event) => updateSelect("actualEndHour", event.target.value)}>{live.actualEndHour.options.map((option) => <option key={`eh-${option.value}`} value={option.value}>{option.label || "Hour"}</option>)}</select>
                <select aria-label="Actual finish minute" value={live.actualEndMinute.value} onChange={(event) => updateSelect("actualEndMinute", event.target.value)}>{live.actualEndMinute.options.map((option) => <option key={`em-${option.value}`} value={option.value}>{option.label || "Minute"}</option>)}</select>
              </div>
            </section>

            <section className="appointment-create-section">
              <h4>Payments</h4>
              {live.payments.length ? <div className="ops-closeout-payments">{live.payments.map((payment, index) => <div key={`payment-${index}`}><span>{payment.description}</span><strong>{payment.amount}</strong></div>)}</div> : <p>No payment has been entered in Junkware.</p>}
              <label className="ops-closeout-payment-toggle"><input type="checkbox" checked={addPayment} disabled={!live.paymentMethods.some(option => option.value)} onChange={(event) => setAddPayment(event.target.checked)} /> <span>Add a payment</span></label>
              {!live.paymentMethods.some(option => option.value) && <p role="alert">Payment methods could not be loaded. Reload from JunkWare to try again.</p>}
              {addPayment ? <div className="ops-closeout-payment-entry">
                <fieldset className="ops-closeout-payment-methods"><legend>Payment method</legend>
                  {live.paymentMethods.filter(option => option.value).map(option => <label key={option.value}><input type="radio" name={paymentGroupId} value={option.value} checked={paymentMethod === option.value} onChange={() => { setPaymentMethod(option.value); setPaymentReference(""); setReviewing(false); }} /><span>{option.label}</span></label>)}
                </fieldset>
                <label><span>Payment amount</span><input aria-label="Payment amount" value={paymentAmount} inputMode="decimal" placeholder="Amount" onChange={(event) => setPaymentAmount(event.target.value)} /></label>
                {paymentReferenceLabel(live.paymentMethods.find(option => option.value === paymentMethod)) && <label><span>{paymentReferenceLabel(live.paymentMethods.find(option => option.value === paymentMethod))}</span><input aria-label={paymentReferenceLabel(live.paymentMethods.find(option => option.value === paymentMethod))} value={paymentReference} maxLength={/card/i.test(paymentReferenceLabel(live.paymentMethods.find(option => option.value === paymentMethod))) ? 4 : 30} onChange={event => setPaymentReference(event.target.value)} /></label>}
                <p>Records payment information in JunkWare. Card charges processed through JunkWare are added automatically; record a card payment here only if it was already collected elsewhere. Billed means payment is still owed.</p>
              </div> : null}
            </section>

            {reviewing && <div role="status"><p>Review {category} closeout: {live.loadQuantity || '0'} full trucks{live.loadSize.value ? ` + ${live.loadSize.value}` : ''}. Load price ${Number(inputMoney(live.loadPrice)).toFixed(2)}, discount ${Number(inputMoney(live.discount)).toFixed(2)}.</p><p>Review all amounts, assigned Krewe and payment fields above. Confirmation saves the completed appointment in JunkWare and can publish its normal closeout alert.</p><p>{addPayment ? `Payment to record: ${live.paymentMethods.find(option => option.value === paymentMethod)?.label} · $${Number(inputMoney(paymentAmount)).toFixed(2)}${paymentReference ? ` · ${paymentReferenceLabel(live.paymentMethods.find(option => option.value === paymentMethod))}: ${paymentReference}` : ''}` : 'No new payment will be recorded.'}</p></div>}
            {!canWrite && <p role="status">Your role can read this closeout. A manager must save changes.</p>}
            <div className="ops-closeout-editor-actions">
              <button type="button" className="ops-button" onClick={save} disabled={saving || !canWrite}>{saving ? "Saving and checking JunkWare…" : reviewing ? `Confirm ${category} Closeout in JunkWare` : "Review Closeout"}</button>
            </div>
            </fieldset>
            <button type="button" className="ops-button subtle" onClick={() => void load()} disabled={saving || loading || Boolean(receipt && ['pending', 'uncertain'].includes(receipt.status))}>Reload from JunkWare</button>
          </>
        )}
        {message ? <div className="ops-closeout-editor-message success">{message}</div> : null}
        {error ? <div className="ops-closeout-editor-message error">{error}</div> : null}
      </div>
    </details>
  );
}
