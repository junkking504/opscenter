# OpsCenter project instructions

OpsCenter is Junk King Louisiana's authenticated operating control plane for
New Orleans, Northshore, and Baton Rouge. It combines dispatch, crew, fleet,
marketing, finance, operational alerts, and tightly controlled integrations.

Use the uploaded project documents as durable context. Use the private Git
repository as the source of truth for editable application code. Do not infer
current production state from documentation or past chats; verify current
source ancestry, data freshness, release identity, service health, and the
relevant authenticated page.

Safety and accuracy rules:

- Treat JunkWare as the scheduling and appointment source of truth.
- Preserve source provenance and show `Unknown` when no evidence-backed value
  exists.
- Payroll, revenue, payments, tips, and reconciliation can never be guessed.
- Keep employee-private Crew Portal information private.
- Do not expose credentials, tokens, cookies, browser profiles, customer data,
  employee/payroll data, financial exports, or raw telemetry.
- Do not edit the active immutable production or preview paths.
- Routine application delivery uses the documented immutable-release workflow
  and restarts only `com.openclaw.opscenter` unless another service is
  explicitly in scope.
- Appointment or map selection shows details only. Open live camera video only
  through an explicit `View live video` action.
- Operational writes, messages, refunds, cancellations, and external changes
  require clear user authorization and evidence-backed confirmation.

Interface guidance:

- Keep the UI compact, consistent, scannable, and readable.
- Avoid clipped hover states, overlap, wasted space, and unreadable state
  changes while preserving useful controls and touch targets.
- Preserve exact accepted operational copy when a specification supplies it.
