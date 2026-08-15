"use client";

import { useEffect, useRef, useState } from "react";

type PaymentsStatus = {
  enabled: boolean;
  environment: "sandbox" | "production";
  liveChargesAllowed: boolean;
  paymentScopeGranted: boolean;
  recaptchaSiteKey: string;
  recaptchaConfigured: boolean;
  tokenizationUrl: string;
  maximumAmount: number;
  canCharge: boolean;
  blockers: string[];
};

export type QuickBooksChargeResult = {
  requestId: string;
  chargeId: string;
  status: string;
  amount: string;
  currency: "USD";
  cardLastFour: string;
  cardType: string;
  createdAt: string;
  intuitTid: string;
};

type RecaptchaApi = {
  render: (container: HTMLElement, options: Record<string, unknown>) => number;
  reset: (widgetId?: number) => void;
};

declare global {
  interface Window {
    grecaptcha?: RecaptchaApi;
  }
}

function loadRecaptchaScript(): void {
  if (document.getElementById("opscenter-recaptcha-script")) return;
  const script = document.createElement("script");
  script.id = "opscenter-recaptcha-script";
  script.src = "https://www.google.com/recaptcha/api.js?render=explicit";
  script.async = true;
  script.defer = true;
  document.head.appendChild(script);
}

function sensitiveCardValues(form: HTMLFormElement) {
  const values = new FormData(form);
  const digits = String(values.get("cardNumber") || "").replace(/\D/g, "");
  const month = String(values.get("expMonth") || "").replace(/\D/g, "").padStart(2, "0");
  const enteredYear = String(values.get("expYear") || "").replace(/\D/g, "");
  const year = enteredYear.length === 2 ? `20${enteredYear}` : enteredYear;
  const cvc = String(values.get("cvc") || "").replace(/\D/g, "");
  if (digits.length < 12 || digits.length > 19 || !/^(0[1-9]|1[0-2])$/.test(month) || !/^20\d{2}$/.test(year) || cvc.length < 3 || cvc.length > 4) {
    throw new Error("Check the card number, expiration date, and security code.");
  }
  return {
    card: {
      name: String(values.get("cardholderName") || "").trim(),
      number: digits,
      expMonth: month,
      expYear: year,
      cvc,
      address: {
        streetAddress: String(values.get("streetAddress") || "").trim(),
        city: String(values.get("city") || "").trim(),
        region: String(values.get("region") || "").trim().toUpperCase(),
        postalCode: String(values.get("postalCode") || "").trim(),
        country: "US",
      },
    },
  };
}

function clearSensitiveFields(form: HTMLFormElement): void {
  form.querySelectorAll<HTMLInputElement>("[data-card-sensitive]").forEach((input) => {
    input.value = "";
  });
}

export default function QuickBooksPaymentForm({
  appointmentId,
  jkNumber,
  suggestedAmount,
  onCharged,
}: {
  appointmentId: string;
  jkNumber: string;
  suggestedAmount: string;
  onCharged: (charge: QuickBooksChargeResult) => void;
}) {
  const [status, setStatus] = useState<PaymentsStatus | null>(null);
  const [statusError, setStatusError] = useState("");
  const [amount, setAmount] = useState(suggestedAmount);
  const [confirmed, setConfirmed] = useState(false);
  const [recaptchaToken, setRecaptchaToken] = useState("");
  const [recaptchaReady, setRecaptchaReady] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [retryAvailable, setRetryAvailable] = useState(false);
  const captchaContainer = useRef<HTMLDivElement | null>(null);
  const captchaWidget = useRef<number | null>(null);
  const pendingToken = useRef("");
  const pendingRequestId = useRef("");

  useEffect(() => {
    let active = true;
    fetch("/api/integrations/qbo/payments/status", { cache: "no-store" })
      .then(async (response) => {
        const payload = await response.json();
        if (!response.ok) throw new Error(payload?.error || "QuickBooks Payments status is unavailable.");
        if (active) setStatus(payload as PaymentsStatus);
      })
      .catch((loadError) => {
        if (active) setStatusError(loadError instanceof Error ? loadError.message : "QuickBooks Payments status is unavailable.");
      });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (!processing && !pendingToken.current) setAmount(suggestedAmount);
  }, [processing, suggestedAmount]);

  useEffect(() => {
    if (!status?.canCharge || !status.recaptchaSiteKey || !captchaContainer.current) return;
    loadRecaptchaScript();
    const timer = window.setInterval(() => {
      if (!window.grecaptcha || !captchaContainer.current || captchaWidget.current != null) return;
      captchaWidget.current = window.grecaptcha.render(captchaContainer.current, {
        sitekey: status.recaptchaSiteKey,
        callback: (token: string) => setRecaptchaToken(token),
        "expired-callback": () => setRecaptchaToken(""),
        "error-callback": () => setRecaptchaToken(""),
      });
      setRecaptchaReady(true);
      window.clearInterval(timer);
    }, 200);
    return () => window.clearInterval(timer);
  }, [status]);

  function resetCaptcha(): void {
    setRecaptchaToken("");
    if (window.grecaptcha && captchaWidget.current != null) window.grecaptcha.reset(captchaWidget.current);
  }

  async function tokenize(form: HTMLFormElement, tokenizationUrl: string): Promise<string> {
    const tokenRequestId = crypto.randomUUID();
    const response = await fetch(tokenizationUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Request-Id": tokenRequestId },
      body: JSON.stringify(sensitiveCardValues(form)),
      cache: "no-store",
    });
    const payload = await response.json().catch(() => ({}));
    const token = String(payload?.value || "").trim();
    if (!response.ok || !token) throw new Error("QuickBooks could not securely tokenize this card. Check the card details and try again.");
    return token;
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!status?.canCharge || processing) return;
    if (!confirmed) {
      setError("Confirm the job and amount before charging the card.");
      return;
    }
    if (!recaptchaToken) {
      setError("Complete the fraud-protection check before charging the card.");
      return;
    }

    const form = event.currentTarget;
    setProcessing(true);
    setError("");
    setMessage("");
    try {
      if (!pendingToken.current) {
        pendingToken.current = await tokenize(form, status.tokenizationUrl);
        pendingRequestId.current = crypto.randomUUID();
        clearSensitiveFields(form);
      }

      const response = await fetch("/api/integrations/qbo/payments/charge", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          appointmentId,
          jkNumber,
          amount,
          currency: "USD",
          token: pendingToken.current,
          requestId: pendingRequestId.current,
          recaptchaToken,
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !payload?.charge) {
        if (payload?.retryable) {
          setRetryAvailable(true);
        } else {
          pendingToken.current = "";
          pendingRequestId.current = "";
          setRetryAvailable(false);
        }
        throw new Error(payload?.error || "QuickBooks could not process the payment.");
      }

      const charge = payload.charge as QuickBooksChargeResult;
      pendingToken.current = "";
      pendingRequestId.current = "";
      setRetryAvailable(false);
      setConfirmed(false);
      setMessage(`QuickBooks captured $${charge.amount}${charge.cardLastFour ? ` on the card ending ${charge.cardLastFour}` : ""}. The JunkWare payment is prepared below; save the closeout to record it there.`);
      onCharged(charge);
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "QuickBooks could not process the payment.");
    } finally {
      resetCaptcha();
      setProcessing(false);
    }
  }

  return (
    <details className="ops-qbo-payment-form">
      <summary>Take card payment in OpsCenter</summary>
      <div className="ops-qbo-payment-body">
        {statusError ? <div className="ops-closeout-editor-message error">{statusError}</div> : null}
        {!status && !statusError ? <div className="ops-closeout-editor-message progress">Checking QuickBooks Payments…</div> : null}
        {status && !status.canCharge ? (
          <div className="ops-qbo-payment-unavailable">
            <strong>QuickBooks Payments is not ready.</strong>
            <ul>{status.blockers.map((blocker) => <li key={blocker}>{blocker}</li>)}</ul>
            <a href="/integrations/qbo/status">Review the QBO connection</a>
          </div>
        ) : null}
        {status?.canCharge ? (
          <form onSubmit={submit} autoComplete="on">
            <div className={`ops-qbo-environment ${status.environment}`}>
              {status.environment === "sandbox" ? "SANDBOX — no real funds move" : "LIVE QUICKBOOKS PAYMENT"}
            </div>
            {retryAvailable ? (
              <div className="ops-closeout-editor-message progress">
                The prior result is uncertain. Retry this same attempt; do not enter the card again or start a new charge.
              </div>
            ) : null}
            <div className="ops-qbo-payment-grid">
              <label><span>Amount</span><input name="amount" value={amount} inputMode="decimal" required onChange={(event) => setAmount(event.target.value)} /></label>
              <label className="wide"><span>Name on card</span><input name="cardholderName" autoComplete="cc-name" required={!retryAvailable} data-card-sensitive /></label>
              <label className="wide"><span>Card number</span><input name="cardNumber" autoComplete="cc-number" inputMode="numeric" required={!retryAvailable} data-card-sensitive /></label>
              <label><span>Expiration month</span><input name="expMonth" autoComplete="cc-exp-month" inputMode="numeric" placeholder="MM" required={!retryAvailable} data-card-sensitive /></label>
              <label><span>Expiration year</span><input name="expYear" autoComplete="cc-exp-year" inputMode="numeric" placeholder="YYYY" required={!retryAvailable} data-card-sensitive /></label>
              <label><span>Security code</span><input name="cvc" autoComplete="cc-csc" inputMode="numeric" required={!retryAvailable} data-card-sensitive /></label>
              <label className="wide"><span>Billing street</span><input name="streetAddress" autoComplete="billing street-address" required={!retryAvailable} data-card-sensitive /></label>
              <label><span>City</span><input name="city" autoComplete="billing address-level2" required={!retryAvailable} data-card-sensitive /></label>
              <label><span>State</span><input name="region" autoComplete="billing address-level1" maxLength={2} required={!retryAvailable} data-card-sensitive /></label>
              <label><span>ZIP</span><input name="postalCode" autoComplete="billing postal-code" inputMode="numeric" required={!retryAvailable} data-card-sensitive /></label>
            </div>
            <label className="ops-qbo-confirmation">
              <input type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} />
              <span>I confirm this is {jkNumber}, the amount is correct, and the customer authorized this charge.</span>
            </label>
            <div ref={captchaContainer} className="ops-qbo-recaptcha" aria-label="Payment fraud protection" />
            <button type="submit" className="ops-button" disabled={processing || !recaptchaReady || !recaptchaToken}>
              {processing ? "Processing one payment…" : retryAvailable ? "Retry the same payment" : `Charge $${amount || "0.00"} in QuickBooks`}
            </button>
            <p className="ops-qbo-payment-note">Card details go directly from this browser to Intuit. OpsCenter stores only the charge reference and last four digits.</p>
          </form>
        ) : null}
        {message ? <div className="ops-closeout-editor-message success" role="status">{message}</div> : null}
        {error ? <div className="ops-closeout-editor-message error" role="alert">{error}</div> : null}
      </div>
    </details>
  );
}
