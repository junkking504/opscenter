# Mobile job closeout

The mobile review surface presents only the current released job, appointment information,
before/after photo selection, and a four-step closeout: Details, Charges, Payment,
Review. The closeout is the existing `AppointmentCloseout` component with an
opt-in mobile presentation. Its default management presentation is unchanged.
All source-version, validation, payment and uncertain-save handling remain in
that component and the existing operation transport.

This is a local design preview, not a launched employee application. Its sample
records are fictional. Its fetch adapter never forwards requests, and its HTML
also forbids network connections through CSP. Confirming returns an explicit
preview-only result. Photo selections use temporary object URLs; they are not
uploaded or persisted. Changing job sections preserves the closeout draft in
memory, but returning to the current-assignment screen or refreshing discards it.

Build with `node scripts/build-mobile-closeout-preview.mjs <output-directory>`.
Open the generated `index.html` locally. Test with
`node --import tsx scripts/test-mobile-closeout.ts <index.html>`.

## Company-phone access — September 18, 2026

Crew job access uses **company phones only**. Managers may use their personal
phones and normal manager accounts to access the full schedule. The phone page
links directly to the protected Schedule workspace, preserving the normal
manager sign-in and server permissions. Setup codes grant only crew truck access;
they never grant manager permissions. `/crew-phones` is a
manager-only setup page; `/crew-jobs` is the phone setup page. A manager selects
the truck and phone label and generates a six-digit numeric code valid for ten minutes.
Codes preserve leading zeros and never reuse a previously issued value. Eight failed
setup attempts trigger a shared 15-minute lockout that survives server restarts
and cannot be bypassed by changing IP addresses or connection keys. The already-
bound phone can still recover a lost enrollment response.
Only one phone can redeem a code. Managers should enter it on the company phone
in their possession. The phone cannot self-register or select a truck.

Enrollment creates a separate 90-day crew-phone connection, not an OpsCenter
manager session, payroll login or inspection connection. Every future job API
must resolve this connection and its truck from server storage for each request.
The inspection app's public connection must never authorize customer job access.
Enrollment proves manager approval of a browser connection; it does not detect
physical company ownership or provide MDM/hardware attestation.

The phone keeps a random recovery key and setup code locally until a cookie-based
read confirms enrollment. A lost response can be recovered using that same pair,
including after the invitation expires. A second phone cannot reuse the code.
Only hashes of keys and codes are stored on the server. The cookie is Secure,
HTTP-only, SameSite Strict, host-only and scoped to `/api/crew-jobs`. Sessions and
setup require HTTPS. All POST requests require an exact same-origin header. Enrollment bodies are
limited to 4 KiB, closeouts to 16 KiB and photo requests to 6 MiB (4 MiB decoded
images). Responses are private and never cached.

The manager can cancel an unused code or revoke a connected phone. A revoked
connection/code cannot enroll again. To change trucks, revoke the old connection
and issue a new code; local edits cannot change the server-owned truck. The UI
does not add personal accounts or silently sign a phone in as a manager.

The enrollment store lives in `data/crew-phones`, outside immutable releases via
the normal runtime data mount. `OPS_CREW_PHONE_DIR` provides isolated test storage.
The manager-only phone directory is stored in `data/crew-phones/directory.json`
with company phone/truck mappings and manager contact numbers. Selecting a
company contact fills the setup form; directory entries do not enroll browsers
or grant account permissions. Phone numbers and names remain in private runtime
storage, outside Git.

Atomic, immutable records retain issuing and revoking actors; corrupt storage
fails closed. No service, subscription, polling or provider SDK is introduced.

**Implementation status — resumed September 18:** enrollment, manager dispatch,
current-assignment reads and photo uploads are implemented in the task branch.
`/crew-dispatch` releases a source-confirmed truck appointment and optionally
queues one next appointment. The phone receives only the current customer and
address. Source reassignment, stale snapshots and revoked phones fail closed.

Photo selection is private to the company browser and dispatch assignment, with
24-hour recovery in IndexedDB. Expired records are purged on storage access;
disconnection or rejected authentication clears all local photo drafts. Photos
are compressed on the device and uploaded only on explicit action. The server
binds uploads to the current truck/date/appointment under the shared appointment
lock. Durable request receipts precede the source upload; uncertain outcomes
require exact-filename source read-back and are never automatically resubmitted.
No real phone was enrolled or customer photo uploaded during implementation.

New closeout receipts retain their original `createdAt`. Dispatch advancement
requires a verified Completed closeout with source photos from the current
release cycle and a fresh source check; an old receipt with a newly updated
recovery timestamp cannot unlock the next customer. Legacy receipts without
creation time do not establish the current cycle.

**Payment decision — September 18:** crews record payments already collected.
Recording a card payment does not charge the card. The phone can record cash,
card or check using the source payment options; office billing is excluded.
Card references accept only the last four digits. Existing source payments are
shown separately, and the user reviews the amount and balance before confirming.

`/api/crew-jobs/closeout` uses the separate company-phone session. Server-owned
truck, assignment, date and appointment scope are rechecked under the shared
source lock. The phone can complete its current job; cancellation, reassignment
and arbitrary schedule actions are rejected. Receipts record the device,
assignment and source-assigned crew, which is not individual employee identity.
The shared JunkWare writer performs source-version, payment and photo checks.

The four-step editor uses Details, Charges, Payment and Review. Drafts are
private to device/assignment and recover for 24 hours only against an identical
source version. Assignment changes and disconnect clear local closeout drafts.
A durable request identity is saved locally before submitting once; financial
writes are never queued offline or automatically replayed. Lost responses poll
only the saved receipt. Check Saved Result reads the source; ambiguous partial
changes stay blocked for office review. Completed source records cannot receive
another crew payment. Verified closeouts use the existing normal notification
and truck-load reconciliation paths.

Run `npm run verify:crew-phones` for isolated enrollment, race, cookie, origin,
expiry, revocation and authorization tests. Run `npm run verify:mobile-closeout-rules`
for source-photo and next-assignment policy tests. These suites do not call a provider, enroll a real phone or change a real
appointment. `verify:crew-dispatch` and `verify:crew-job-photos` cover durable
dispatch, upload recovery and scope checks. `scripts/test-crew-jobs-browser.ts`
tests the production-built phone UI with synthetic API responses at 320/390/430px.
`verify:crew-closeout` covers payment scope and receipt recovery, and
`scripts/test-crew-closeout-browser.ts` covers collected-payment entry, source-
versioned draft recovery, review and lost-response verification without replay.


## Daily phone crew

After one-time device enrollment, the phone must be enabled for each Central
calendar day. The person taking responsibility selects their name, the driver
and navigator (or driver only) from the active configured crew roster. The API
returns only employee names, never usernames, payroll or credentials.

Immutable daily revisions in `data/crew-phones/days/<device>/<date>` retain the
responsible person, selected crew, device/truck, time and request identity. Reads
recover a lost response; duplicate request IDs cannot create another revision.
Day changes require a new selection. A shared-phone selection records a declared
assignment, not independent proof of a person’s identity or a payroll clock-in.

Each new closeout resolves these names uniquely against that appointment’s live
JunkWare driver/navigator options. The daily driver and navigator are prefilled
and retained; additional job crew can be added in the closeout. Extra job crew
do not change tomorrow’s or the next job’s defaults. Missing or ambiguous source
identities block saving. Updating the daily crew invalidates an older closeout
draft and an older submitted crew version. Saved or uncertain closeouts retain
their original receipt and crew evidence.

Run `verify:crew-phone-day` and `verify:crew-closeout` for day/identity/payment
contracts. Phone browser tests cover daily setup and additional job crew.

## Completion and next-assignment rules

- A completion requires at least one photo observed on the owning JunkWare
  appointment, with the exact appointment ID in an approved source media URL.
  Local selections, upload counts, unrelated images and unavailable evidence
  cannot satisfy the requirement. Before/after sections organize photos; both
  categories are not separately mandatory.
- The shared closeout writer checks evidence before any mutation and on read-back.
  This applies to Completed closeouts and classification paths completing an
  estimate. Saving a Confirmed draft remains possible without photos.
- A server-owned verified closeout receipt must identify the current appointment,
  Completed source status and saved photos before unlocking another assignment.
  Pending, failed, uncertain, canceled or merely reconciled changes do not unlock it.
- Dispatch must explicitly release the next job. No released job means waiting.
  Missing or ambiguous current-job source data means unavailable, never advance.
- The current-job API binds release state to the enrolled truck and dispatch
  cycle, reads receipts from durable server storage, rechecks source state and
  returns only approved current-job fields. Never send the day
  schedule, queued customer data or a future address to the phone and hide it
  with CSS. Never accept completion evidence supplied by the phone.

## Company-phone pilot acceptance

Implementation and synthetic checks do not establish actual camera or customer
source acceptance. On a manager-enrolled company phone, verify camera/library
selection, keyboard visibility, poor connectivity, repeated taps and reopen/read-
back of an authorized real closeout. Confirm source photos, payment reference,
amount and balance, and reveal the queued customer only after verified completion.
Never create a customer payment or closeout solely as a production test.

Manager setup is `/crew-phones`; dispatch is `/crew-dispatch`; phones use
`/crew-jobs`. Deploy through the normal immutable production controller. Keep
release/service health, browser acceptance and actual phone pilot evidence
separate. No paid provider, subscription or background polling was introduced.

## Product Design pass — September 17, 2026

### Design brief

The intended user is a crew member finishing a job on site. The primary outcome
is a correctly saved closeout with evidence and a clear result the employee can
trust. The approved access model is a manager-enrolled company truck phone. The September 18 decision authorizes crews to record collected payments;
individual employee login is not part of phone enrollment.

Preserve OpsCenter's brand tokens and existing JunkWare closeout rules. Prioritize
readable controls in daylight, one-handed use, a visible primary action, and
recovery after interruptions. No new native-app framework is selected by this
brief; the existing source is the current implementation target.

### Proposed employee journey

| Step | Primary action | Required behavior |
| --- | --- | --- |
| 1. Current assignment | Open job / Continue draft | Show only the current released appointment for the enrolled truck. Source status and draft status are separate. |
| 2. Confirm the job | Start closeout | Keep customer, service address, job number and notes visible. Identify Completed records as saved records rather than fresh work. |
| 3. Photos | Add before / after photos | Support camera and photo library. Distinguish selected, uploading, uploaded and failed images. Preserve local images until upload is verified. |
| 4. Work details | Continue to charges | Confirm completion outcome, actual crew and actual times. Mark GPS suggestions as suggestions. Jump to missing required fields before advancing. |
| 5. Charges | Continue to payment | Start from source charges. Show load price, extra charges, discount, tip and total distinctly; collapse unused optional charge groups. |
| 6. Payment | Review job | Separate existing payments from new payment entries and unpaid balances. Clearly state that recording a card payment does not charge it. |
| 7. Review | Confirm closeout | Show identity, work, money and photo-upload status together. Provide an Edit link to each relevant step. |
| 8. Saved result / Waiting | Open released job | Require verified completion with photos before revealing the next dispatched job. Wait if dispatch has not released one. Unknown outcomes offer Check saved result, never a fresh submission. |

### Original design priorities (implemented September 18)

1. **Draft recovery.** Source-versioned drafts belong to the enrolled phone and
   appointment. A saved draft never means the job was closed out.
2. **Separate payment authority.** Company-phone sessions authorize only their
   current closeout and collected payments; manager and inspection credentials
   are separate.
3. **Step validation and recovery.** The existing save validation runs at Review.
   In the mobile presentation, direct each error back to its field and step;
   preserve inputs when the user checks another section or corrects an error.
4. **Photo receipts.** The company-phone implementation reports selection, upload
   and exact source acknowledgment per photo.
5. **Completion receipt.** The company-phone implementation distinguishes verified,
   pending, failed and uncertain results. Only verified completion can advance.

### Design references and evidence limits

Mobbin references inspected during this pass:

- [Jobber job creation and detail](https://mobbin.com/flows/59cc7ab8-69a0-4295-93e5-27735c624281),
  preview screens 4, 8 and 11: customer/address context, grouped details,
  and separate invoice/payment sections.
- [Jobber task flow](https://mobbin.com/flows/23b599ad-18e2-45aa-93de-710cfe134d3d),
  preview screen 6: a prominent Complete Task action alongside directions and
  instructions.
- [Jobber payment receipt](https://mobbin.com/flows/d691874d-c3f1-47e5-95f1-593b1287d5f5),
  both screens: Payment Recorded confirmation followed by method, amount and
  transaction details. These are reference patterns, not evidence of OpsCenter
  behavior or a prescription to copy Jobber's navigation.

This pass used the current source and reference screens. A new visual audit was
not completed: the in-app browser URL policy denied the local file preview. The
earlier synthetic browser checks remain separate evidence, not a current
authenticated employee acceptance test. Actual phone-camera behavior, assistive
technology, keyboard obstruction, loss of connectivity, employee scope and live
source read-back remain to be tested before launch.

## Kingpin company-phone app

`https://kingpin.junk-king.app` is the company-phone entry address. The app header, browser title and installed-app name are Kingpin. Its root redirects
into `/crew-jobs`; only that page, its exact crew-job API endpoints and Next assets
are served there. Every crew API still requires its own phone session. Management,
payroll, login and webhook routes return 404 on this hostname. The manager schedule
link opens the existing authenticated Schedule at `ops.junk-king.app`.

The manager setup page displays the new address. The existing
`ops.junk-king.app/crew-jobs` entry remains available for enrolled devices and saved
drafts: cookies and browser drafts are origin-bound and are not copied between
hosts. Connect a phone on the new address using a new six-digit setup code; finish
any outstanding draft on its original address before switching.

DNS should be a proxied CNAME to the existing Mission Control tunnel
`30d8a080-e2d1-4452-b463-4ba2ba8e57ba.cfargotunnel.com`. The private local tunnel
configuration includes `kingpin.junk-king.app` and the legacy `jobs.junk-king.app` forwarding to the existing loopback
OpsCenter service on port 3000. No new cloud service or paid provider is required.
Deployment readiness, public DNS/TLS and live page acceptance are separate checks.

The legacy jobs hostname remains an isolated app alias so existing phone cookies,
drafts and receipts are still accessible there. It does not redirect an active
phone session across origins. Opening Kingpin on a new origin requires company-phone
setup; browser storage and host-only cookies do not move between hostnames.
