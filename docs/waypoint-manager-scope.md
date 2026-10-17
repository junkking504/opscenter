# Waypoint manager access

Waypoint managers have an exact-contact grant in the private runtime file
`data/crew-phones/manager-access.json`. It contains schema 1, purpose
`waypoint-manager`, approval actor/time, and approved directory tuples
`{kind, name, number}`. No personal contacts or live grants belong in Git.

A grant requires an authenticated, non-test, unrevoked phone enrolled today;
its immutable enrollment actor must match the approved phone number's self-setup
identity. The contact must still uniquely match the directory's exact name,
number and manager/company section. Labels, selected crew names, payroll accounts,
truck assignments and generic OpsCenter roles do not establish this identity.
Missing, malformed, future-dated, ambiguous or revoked grants fail closed.
New enrollment for the same verified contact inherits eligibility. No enrollment
is fabricated to activate a grant; an eligible contact without an active binding
still needs the existing approved setup flow.

## Capabilities

The manager screen reads every appointment in the selected day's local schedule,
including all trucks and unassigned/closed appointments, without requiring daily
truck setup. It reuses existing source-version checks, operation receipts and
handlers for booking/duplicate review, truck/time assignment, rescheduling,
restoration, cancellation, notes, call-ahead, manual stop order, open-appointment
charge editing, dispatch and device enrollment/live-access grants/revocation.

Cross-truck completion uses an explicit manager work context: choose the actual
truck and responsible person, driver and navigators, then enter the crew workflow.
This updates only this phone's versioned daily attribution; it transfers no jobs.
Existing truck-switch interlocks, inspection, source checks, photos, signatures,
idempotency and collected-payment rules remain. The office edit adapter rejects
completion, payments, photo-policy overrides and edits to closed appointments.
Billed payments remain unavailable in Waypoint.

Phone management grants only ordinary device access; it cannot add managers.
The manager gateway does not expose setup-message sending or route-provider
suggestions. Those retain their separate approval workflows. No finance reports,
payroll, infrastructure or integration administration is included.

## Authorization boundaries

`/api/crew-jobs/manager` authenticates the phone and exact manager grant before
reading or delegating. POST uses the existing same-origin/JSON checks. A closed
resource/method/action allowlist selects internal handlers. Request-local
AsyncLocalStorage provides a revalidated actor only to those selected handlers;
there is no OpsCenter cookie, general role binding, header override or public
proxy. The ordinary office endpoints cannot authenticate a crew cookie directly.

Ordinary crew users retain their truck-scoped feed and write authorization.
Managers' crew view can browse other trucks, but those projected rows carry no
closeout identifiers. The original job-scope resolver remains truck-scoped;
manager work context is the explicit path to cross-truck crew actions.

## Verification and rollout

Run `npm run verify:waypoint-manager`, `npm run verify:waypoint-visibility`, the
closeout/dispatch regressions, typecheck, lint and the production build. Browser
fixtures in `scripts/test-waypoint-manager-browser.mjs` mock every API and block
external requests. Do not test mutations on real appointments, payments or phones.

Deploy source through the installed controller with release preservation enabled.
Install the exact separately approved runtime grant only after release health is
verified. Report eligible contacts, current enrolled devices, read-only runtime
verification and physical handset verification as separate evidence.
