"use client";

import { useState } from "react";

type Option = { value: string; label: string };
type OtherCharge = { label: string; quantity: string; price: string; total: string };
type PendingOtherCharge = OtherCharge & { clientId: string; typeValue: string };
type LiveCloseout = {
  status: { value: string; label: string };
  driver: Option;
  drivers: Option[];
  navigators: Option[];
  navigatorOptions: Option[];
  loadQuantity: string;
  loadSize: { value: string; label: string; options: Option[] };
  loadPrice: string;
  bedloadQuantity: string;
  bedloadSize: { value: string; label: string; options: Option[] };
  bedloadPrice: string;
  otherChargeOptions: Option[];
  otherCharges: OtherCharge[];
  discount: string;
  tip: string;
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

export default function JobCloseoutEditor({ appointmentId, appointmentUrl, initialStatus }: { appointmentId: string; appointmentUrl: string; initialStatus: string }) {
  const resolvedAppointmentId = appointmentId || String(appointmentUrl || "").match(/[?&]id=(\d{1,12})(?:&|$)/i)?.[1] || "";
  const [live, setLive] = useState<LiveCloseout | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [addPayment, setAddPayment] = useState(false);
  const [paymentMethod, setPaymentMethod] = useState("");
  const [paymentAmount, setPaymentAmount] = useState("");
  const [otherChargeType, setOtherChargeType] = useState("");
  const [otherChargeQuantity, setOtherChargeQuantity] = useState("1");
  const [otherChargePrice, setOtherChargePrice] = useState("");
  const [pendingOtherCharges, setPendingOtherCharges] = useState<PendingOtherCharge[]>([]);
  const otherChargePriceIsAutomatic = otherChargeType.split("|")[2] === "1";

  if (/cancel(?:ed|led)/i.test(initialStatus)) return null;

  async function load() {
    if (!resolvedAppointmentId) {
      setError("This job does not have a Junkware appointment link yet.");
      return;
    }
    setLoading(true);
    setError("");
    setMessage("");
    try {
      const response = await fetch(`/api/job-closeout?appointmentId=${encodeURIComponent(resolvedAppointmentId)}`, { cache: "no-store" });
      const payload = await response.json();
      if (!response.ok || !payload?.closeout) throw new Error(payload?.error || "The Junkware closeout could not be loaded.");
      setLive(payload.closeout);
      setPendingOtherCharges([]);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "The Junkware closeout could not be loaded.");
    } finally {
      setLoading(false);
    }
  }

  function update<K extends keyof LiveCloseout>(key: K, value: LiveCloseout[K]) {
    setLive((current) => current ? { ...current, [key]: value } : current);
  }

  function updateSelect(key: "loadSize" | "bedloadSize" | "jobCategory" | "actualStartHour" | "actualStartMinute" | "actualEndHour" | "actualEndMinute", value: string) {
    setLive((current) => current ? { ...current, [key]: { ...current[key], value } } : current);
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
    setPendingOtherCharges((current) => current.filter((charge) => charge.clientId !== clientId));
  }

  async function save() {
    if (!live) return;
    const navigatorIds = live.navigators.map((row) => row.value).filter(Boolean);
    if (!live.driver.value) {
      setError("Choose a driver before saving the closeout.");
      return;
    }
    if (new Set([live.driver.value, ...navigatorIds]).size !== 1 + navigatorIds.length) {
      setError("Each assigned person can only appear once on the job.");
      return;
    }
    if (addPayment && (!paymentMethod || !inputMoney(paymentAmount))) {
      setError("Choose a payment method and enter an amount, or turn off Add payment.");
      return;
    }
    setSaving(true);
    setError("");
    setMessage("");
    try {
      const response = await fetch("/api/job-closeout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          appointmentId: resolvedAppointmentId,
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
          actualStartHour: live.actualStartHour.value,
          actualStartMinute: live.actualStartMinute.value,
          actualEndHour: live.actualEndHour.value,
          actualEndMinute: live.actualEndMinute.value,
          addPayment: addPayment ? { methodId: paymentMethod, amount: inputMoney(paymentAmount) } : null,
        }),
      });
      const payload = await response.json();
      if (!response.ok || !payload?.closeout) throw new Error(payload?.error || "Junkware did not save the closeout.");
      setLive(payload.closeout);
      setAddPayment(false);
      setPaymentMethod("");
      setPaymentAmount("");
      setPendingOtherCharges([]);
      setMessage("Saved and verified in JunkWare.");
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Junkware did not save the closeout.");
    } finally {
      setSaving(false);
    }
  }

  const completed = /complete|closed/i.test(live?.status.label || initialStatus);

  return (
    <details className="ops-job-closeout-editor" data-appointment-id={resolvedAppointmentId} aria-busy={loading || saving}>
      <summary>{completed ? "Edit closeout or crew" : "Close out this job"}</summary>
      <div className="ops-job-closeout-editor-body">
        {!live ? (
          <button type="button" className="ops-button" onClick={load} disabled={loading || !resolvedAppointmentId}>
            {loading ? "Loading current JunkWare closeout…" : "Open JunkWare closeout"}
          </button>
        ) : (
          <>
            <div className="ops-closeout-editor-heading">
              <div><span>Junkware status</span><strong>{live.status.label || "Unavailable"}</strong></div>
              <div><span>Current total</span><strong>{live.total || "$0.00"}</strong></div>
              <div><span>Balance</span><strong>{live.balance || "0.00"}</strong></div>
            </div>
            {saving ? <div className="ops-closeout-editor-message progress" role="status" aria-live="polite">Saving changes and checking them in JunkWare…</div> : null}

            <section className="ops-closeout-editor-section">
              <h4>Crew Assigned to This Job</h4>
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

            <section className="ops-closeout-editor-section">
              <h4>Job Charges</h4>
              <div className="ops-closeout-editor-grid">
                <label><span>Truck quantity</span><input value={live.loadQuantity} inputMode="decimal" onChange={(event) => update("loadQuantity", event.target.value)} /></label>
                <label><span>Load size</span><select value={live.loadSize.value} onChange={(event) => updateSelect("loadSize", event.target.value)}>{live.loadSize.options.map((option) => <option key={`load-${option.value}`} value={option.value}>{option.label || "Full truck / none"}</option>)}</select></label>
                <label><span>Load price</span><input value={live.loadPrice} inputMode="decimal" onChange={(event) => update("loadPrice", event.target.value)} /></label>
                <label><span>Bedload quantity</span><input value={live.bedloadQuantity} inputMode="decimal" onChange={(event) => update("bedloadQuantity", event.target.value)} /></label>
                <label><span>Bedload size</span><select value={live.bedloadSize.value} onChange={(event) => updateSelect("bedloadSize", event.target.value)}>{live.bedloadSize.options.map((option) => <option key={`bed-${option.value}`} value={option.value}>{option.label || "None"}</option>)}</select></label>
                <label><span>Bedload price</span><input value={live.bedloadPrice} inputMode="decimal" onChange={(event) => update("bedloadPrice", event.target.value)} /></label>
                <label><span>Discount</span><input value={live.discount} inputMode="decimal" onChange={(event) => update("discount", event.target.value)} /></label>
                <label><span>Tip</span><input value={live.tip} inputMode="decimal" onChange={(event) => update("tip", event.target.value)} /></label>
                <label><span>Job category</span><select value={live.jobCategory.value} onChange={(event) => updateSelect("jobCategory", event.target.value)}>{live.jobCategory.options.map((option) => <option key={`category-${option.value}`} value={option.value}>{option.label || "Choose category"}</option>)}</select></label>
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

            <section className="ops-closeout-editor-section">
              <h4>Actual Job Time</h4>
              <div className="ops-closeout-time-grid">
                <span>Started</span>
                <select value={live.actualStartHour.value} onChange={(event) => updateSelect("actualStartHour", event.target.value)}>{live.actualStartHour.options.map((option) => <option key={`sh-${option.value}`} value={option.value}>{option.label}</option>)}</select>
                <select value={live.actualStartMinute.value} onChange={(event) => updateSelect("actualStartMinute", event.target.value)}>{live.actualStartMinute.options.map((option) => <option key={`sm-${option.value}`} value={option.value}>{option.label}</option>)}</select>
                <span>Finished</span>
                <select value={live.actualEndHour.value} onChange={(event) => updateSelect("actualEndHour", event.target.value)}>{live.actualEndHour.options.map((option) => <option key={`eh-${option.value}`} value={option.value}>{option.label}</option>)}</select>
                <select value={live.actualEndMinute.value} onChange={(event) => updateSelect("actualEndMinute", event.target.value)}>{live.actualEndMinute.options.map((option) => <option key={`em-${option.value}`} value={option.value}>{option.label}</option>)}</select>
              </div>
            </section>

            <section className="ops-closeout-editor-section">
              <h4>Payments</h4>
              {live.payments.length ? <div className="ops-closeout-payments">{live.payments.map((payment, index) => <div key={`payment-${index}`}><span>{payment.description}</span><strong>{payment.amount}</strong></div>)}</div> : <p>No payment has been entered in Junkware.</p>}
              <label className="ops-closeout-payment-toggle"><input type="checkbox" checked={addPayment} onChange={(event) => setAddPayment(event.target.checked)} /> <span>Add a payment</span></label>
              {addPayment ? <div className="ops-closeout-payment-entry">
                <select value={paymentMethod} onChange={(event) => setPaymentMethod(event.target.value)}>{live.paymentMethods.map((option) => <option key={`payment-method-${option.value}`} value={option.value}>{option.label || "Choose method"}</option>)}</select>
                <input value={paymentAmount} inputMode="decimal" placeholder="Amount" onChange={(event) => setPaymentAmount(event.target.value)} />
              </div> : null}
            </section>

            <div className="ops-closeout-editor-actions">
              <button type="button" className="ops-button" onClick={save} disabled={saving}>{saving ? "Saving and checking JunkWare…" : completed ? "Save changes in JunkWare" : "Save and close job in JunkWare"}</button>
              <button type="button" className="ops-button subtle" onClick={load} disabled={saving || loading}>Reload from JunkWare</button>
            </div>
          </>
        )}
        {message ? <div className="ops-closeout-editor-message success">{message}</div> : null}
        {error ? <div className="ops-closeout-editor-message error">{error}</div> : null}
      </div>
    </details>
  );
}
