# Reliability Audit Log

## 2026-08-22 — JunkWare truck-assignment email validation

- Severity: high (a permanent JunkWare validation rejection was retried as though transient).
- Symptom: JunkWare rejected truck-assignment saves with its valid-email-or-blank validation message, while OpsCenter kept the assignment in `pending` and retried it.
- Evidence: the assignment bridge submits only appointment and truck identifiers; the JunkWare ASP.NET appointment form submits the customer-email control as part of its full save. A read-only live inspection found that control currently syntactically valid, so no email value is recorded here.
- Fix: trim valid customer emails before a JunkWare appointment save; clear blank, placeholder, whitespace-only, or malformed values so the WebForms save uses JunkWare's accepted blank representation. Explicit JunkWare form-validation rejections now persist as `manual_correction`, are surfaced in Dispatch, and are excluded from the retry queue.
- Regression coverage: `verify:junkware-assignment-email` checks blank and malformed values never reach the WebForms save as bad values, verifies valid-value trimming, and verifies the validation rejection is terminal while a timeout remains retryable.
- Verification: focused verifier and lint passed; production build passed. The complete `verify:*` run had four pre-existing/environment failures: missing August authoritative monthly reconciliation, schedule-map geocode assertion, absent isolated accessibility credentials, and no live Truck 9 camera.
- Operational boundary: no service restart, reload, deployment, or push was performed.
