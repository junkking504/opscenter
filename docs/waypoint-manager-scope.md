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

## Route map and mobile layout

Waypoint shows the selected truck's remaining appointments as numbered map pins
and a matching Route Order list. Completed work and shared Amazon appointments
outside that truck remain separately accessible. Existing all-truck readers can
select a truck to browse; this does not change work context or grant write access.

Locations are projected only after the fresh source's membership/status/truck
filter, using the existing verified geocode cache or labeled approximate fallback.
No geocoding, routing-provider request or new polling is added. Missing locations
stay in the numbered list, and co-located appointments share a marker that exposes
every stop. Map numbers never depend on whether coordinates are available.

The manager uses compact date/action controls, appointment rows and accessible
44px earlier/later buttons. Reordering keeps the existing source-key concurrency
check and changes neither booked times nor truck assignments. Date/time inputs
have bounded intrinsic widths for narrow iPhone layouts.

## Named OpsCenter account sign-in

Waypoint also accepts a current named OpsCenter Manager or Administrator session through
`/login?next=/crew-jobs`. Sign-in is served only on `waypoint.junk-king.app`; the `kingpin.` and legacy `jobs.` hosts return 404 for `/login`, `/api/auth/login`, `/api/auth/logout` and `/api/crew-jobs/manager-session`. Credentials are the same on both hosts; cookies remain
host-only, so users sign in separately on each site. The public Waypoint entry
shows Manager sign-in. Named account configuration is documented in
[OpsCenter accounts](ops-accounts.md).

The manager gateway authenticates the account before schedule reads and delegates
only its existing closed resource/action allowlist. Office handlers independently
check the same account session and retain its audit identity. Phone enrollment is
not synthesized from an account. A named account signed in on an already approved manager phone retains its phone
work context. Account-only sessions cannot set phone work
context or bypass crew inspection, assignment, photos or payment rules. The crew
workflow still requires its ordinary approved phone setup.
