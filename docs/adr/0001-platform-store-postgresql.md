# ADR 0001: PostgreSQL for OpsCenter-Owned State

Status: Accepted for preview implementation  
Date: 2026-08-10

## Context

The Operating Inbox requires transactional work ownership, optimistic concurrency, durable action runs, approvals, events, and an outbox. The existing JSON stores are useful projections and compatibility stores, but they cannot safely become the shared transactional kernel for multiple users and workers.

## Decision

Use PostgreSQL for new OpsCenter-owned platform state while retaining the existing JSON files as source observations and compatibility projections during migration.

The application uses the `pg` Node.js client. Schema changes are explicit, ordered SQL migrations. The application never runs migrations automatically during startup; operators use the dedicated migration command in a supervised environment.

The kernel is disabled unless `OPSCENTER_KERNEL_ENABLED=1` is set. Each runtime has a distinct database URL variable:

- `OPSCENTER_PREVIEW_DATABASE_URL`
- `OPSCENTER_MISSION_CONTROL_DATABASE_URL`
- `OPSCENTER_LIVE_DATABASE_URL`
- `OPSCENTER_VPS_DATABASE_URL`

Preview does not fall back to a production URL. Its database name must contain `preview` before the application will connect.

## Consequences

- PostgreSQL becomes a future runtime dependency only after preview installation, backup, restore, migration, and failure-mode validation.
- Existing production behavior remains unchanged while the kernel is disabled.
- Database failure blocks kernel mutations rather than falling back to unaudited file writes.
- Source-system observations remain clearly distinct from OpsCenter-owned state.
- A production database installation or service change requires a separate supervised operation.

## Rejected alternatives

### Continue with JSON files

Rejected as the kernel store because cross-record transactions, concurrent workers, constraints, and durable queue claims would require rebuilding database behavior in application code.

### Embedded SQLite

Deferred as a possible developer-test adapter. It would simplify local setup, but PostgreSQL better matches the concurrency and worker model required by the operating control plane.

### Managed cloud database first

Deferred. It adds network dependence and changes the current local operating boundary before the kernel has proved its value in isolated preview.
