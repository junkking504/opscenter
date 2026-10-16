# Waypoint manager scope: pending definition and activation approval

The current deployed architecture does not define a Waypoint manager role.
`CrewPhone` has device identity, truck, label, enrollment/expiry and optional test
state; it has no role. The private directory's `managers` section selects approved
setup recipients, not permissions. Waypoint's host allowlist exposes only the
phone/inspection app and APIs. Those APIs authenticate the phone cookie, saved
truck day and inspection; they do not consume the OpsCenter role bindings.

The existing **OpsCenter** `manager` bundle in `lib/ops-roles.ts` grants
`operations.read`, `operations.write`, `finance.read`, and `sensitive.write`.
It does not grant `platform.manage`. Roles belong to OpsCenter session identities,
not phone numbers or payroll usernames. There is no source-backed general mapping
from those identities to Waypoint phone bindings.

Relevant existing office capabilities include:

- Schedule visibility and appointment creation, assignment/moves, ordering,
  rescheduling/restoration, cancellation, notes and call-ahead status.
- Appointment classification, source-verified closeout and payment recording.
  Office and Waypoint closeout policies differ: Waypoint requires job photos,
  only records collected payments (no Billed), and uses the saved daily crew.
- Crew dispatch release/queue management on supported trucks.
- Company-phone enrollment, setup-message requests under the separate spending
  approval, revocation and device-specific sandbox-to-live grants.

The generic office manager bundle also permits finance views, payroll corrections,
manual bonuses, resale management and certain integration changes. These are not
Waypoint permissions and must not be inherited by adding a mobile manager role.
Platform recovery and integration connection administration remain admin-only.

A Waypoint-only manager role therefore needs an explicit capability definition
before it can be prepared as a complete implementation. Confirm which office
capabilities above should be exposed in Waypoint, especially cross-truck
closeout/payment recording, cancellation/restoration, and phone-access grants.
State whether office closeout rules should replace Waypoint's photo, collected-
payment and daily-crew restrictions. Existing safety/source/idempotency checks
should remain; manager status alone must not silently waive them.

The accompanying all-truck browsing patch is a tested, disabled-by-default
foundation from the earlier visibility-only scope. It is not an implementation
of the subsequently requested full manager role and must not be presented or
activated as one. No approval file, personal contacts, runtime roles or live
configuration are included in this source change. Exact-contact and capability
approval is still required before activation.
