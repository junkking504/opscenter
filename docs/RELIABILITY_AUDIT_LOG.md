# Reliability Audit Log

## 2026-08-22 — JunkWare truck-assignment email validation

- Severity: high (a permanent JunkWare validation rejection was retried as though transient).
- Symptom: JunkWare rejected truck-assignment saves with its valid-email-or-blank validation message, while OpsCenter kept the assignment in `pending` and retried it.
- Evidence: the assignment bridge submits only appointment and truck identifiers; the JunkWare ASP.NET appointment form submits the customer-email control as part of its full save. A read-only live inspection found that control currently syntactically valid, so no email value is recorded here.
- Fix: trim valid customer emails before a JunkWare appointment save; clear blank, placeholder, whitespace-only, or malformed values so the WebForms save uses JunkWare's accepted blank representation. Explicit JunkWare form-validation rejections now persist as `manual_correction`, are surfaced in Dispatch, and are excluded from the retry queue.
- Regression coverage: `verify:junkware-assignment-email` checks blank and malformed values never reach the WebForms save as bad values, verifies valid-value trimming, and verifies the validation rejection is terminal while a timeout remains retryable.
- Verification: focused verifier and lint passed; production build passed. The complete `verify:*` run had four pre-existing/environment failures: missing August authoritative monthly reconciliation, schedule-map geocode assertion, absent isolated accessibility credentials, and no live Truck 9 camera.
- Operational boundary: no service restart, reload, deployment, or push was performed.

## 2026-08-22 — Jobs closeout label contrast

- Severity: high (active closeout labels and headings failed WCAG AA contrast).
- Root cause: the Jobs stylesheet changed the closeout editor shell to a light background while the shared closeout editor retained dark-theme light text. This was a theme mismatch, not a disabled-state class applied to active labels.
- Fix: retain the shared dark closeout editor surface in Jobs, and style genuinely automatic/disabled controls with a dashed border plus readable muted text rather than reduced opacity or strike-through.
- Contrast: active field label from 1.34:1 to 12.02:1; section heading from 1.06:1 to 17.06:1; disabled field label is 5.71:1. Active normal text exceeds WCAG AA 4.5:1, headings exceed 3:1, and disabled text remains readable.
- Regression coverage: `verify:closeout-label-contrast` asserts the active, heading, and disabled color pairs plus the semantic disabled-state hook.
- Accessibility verifier setup: start an isolated OpsCenter instance at `OPS_A11Y_BASE_URL` (defaults to `http://127.0.0.1:3100`), then provide either `OPS_A11Y_SESSION_COOKIE` as the value of the `opscenter_email_session` cookie for that base URL, or both `OPS_A11Y_USERNAME` and `OPS_A11Y_PASSWORD` for the isolated test account. The verifier must not be pointed at production and does not create or edit jobs.
