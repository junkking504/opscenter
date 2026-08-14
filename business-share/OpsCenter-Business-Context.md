# OpsCenter Business Context

## Purpose

OpsCenter is the operating control plane for Junk King Louisiana operations in
New Orleans, Northshore, and Baton Rouge. Its objective is to improve revenue,
revenue per labor hour, dispatch execution, fleet visibility, crew accuracy,
lead response, financial reconciliation, and early operational awareness.

## Major surfaces

- Daily Command: management awareness, KPIs, alerts, and owned work
- Schedule/Dispatch: appointments, truck assignments, status, routes, and
  evidence-backed visit context
- Crew: attendance, employee-private pay, production metrics, and tips
- Fleet: LinxUp GPS, route history, safety events, and explicit live-camera
  access
- Marketing: calls, lead sources, SearchKings, lost leads, and follow-up
- Finance: JunkWare/QuickBooks/payment reconciliation and evidence-backed
  closeout visibility
- OpsBot: controlled WhatsApp, Slack, collector, and operational-intelligence
  workflows

## System boundaries

- JunkWare remains the source for appointments, schedules, job details, truck
  records, crew time, and operational closeout fields.
- OpsCenter presents normalized operational views and narrowly scoped write
  workflows with validation and audit evidence.
- QuickBooks Online, payment sources, SearchKings, LinxUp, Slack, Meta/WhatsApp,
  Cloudflare, and Reolink are separate integrations with independent access and
  freshness states.
- The private Git repository owns application source and reviewed docs.
- Mission Control owns authoritative runtime data, protected configuration,
  browser sessions, logs, databases, and immutable releases.

## Data integrity

- Prefer normalized JK number plus appointment date as the stable job identity.
- Preserve source system, source record ID, collection timestamp, effective
  date, transformation version, and reconciliation state for important values.
- Separate scheduled jobs, completed jobs, estimates, cancellations,
  reschedules, and open/unclosed jobs.
- Count company revenue exactly once per completed job.
- Never add employee-attributed revenue, tips, payment rows, backups, or other
  representations on top of canonical company revenue.
- Do not guess payroll, revenue, payment, tip, lead, or GPS values. Use
  `Unknown` when the underlying evidence does not exist.

## Operating rules

- Default to read-only analysis unless a requested workflow clearly authorizes
  a write or external action.
- Validate before publishing. An incomplete scrape must not replace a more
  complete canonical record.
- Stage source data and reconcile counts/identities before live publication.
- A successful application health endpoint does not prove every integration or
  authenticated page is current.
- Selection of a truck or appointment never starts live video. The explicit
  `View live video` action is required.
- Crew Portal pay views expose only the signed-in employee's information.
- Exact operational formats and routing decisions must be preserved.

## Delivery

Production runs on Mission Control from immutable release directories. The
stable `opscenter` path is a symlink to the active release and must never be
edited directly. Changes move through Git, verification, push, documented
release creation, service restart, release/health checks, and authenticated
browser verification. Collectors, tunnels, databases, and separate workers are
not restarted as an incidental side effect.

## Collaboration model

- Use the ChatGPT Business project for shared context, discussion, planning,
  and reviewed artifacts.
- Use the private Git repository for complete source, branches, pull requests,
  and code review.
- Use Mission Control runtime paths only for authorized operational work.
- Never upload the whole Mission Control project folder or OpsBot runtime.
