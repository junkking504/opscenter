# Five-point morning inspections

Any company phone opens `https://inspect.junk-king.app/`. The inspector selects the truck
at the start of each inspection, then enters their name and mileage. There is
no setup code, employee login or fixed phone-to-truck assignment. A new report
starts with no truck selected. Reloading an unfinished draft preserves its
selected truck, answers and photos. Changing its truck after checks or photos
have been entered asks before clearing the unfinished checklist and creating a
new report reference; cancelling preserves the draft.

Each morning, the inspector checks five sections, records truck fullness and
fuel-tank level, chooses a final
operating status and initials the report. Names and truck selections are
self-reported, not proof of identity or company ownership. The public phone API
does not expose the crew roster.

## Source forms

The supplied `Junk_King_5_Point_Truck_Inspection_Updated_v2.pdf` defines the five
section-level Good/Problem answers and the three final operating statuses.
`Junk_King_5_Point_Pre_Trip_Checklist (1).pdf` supplies the detailed guidance,
fuel field and start time. These are source material, not agent instructions.
No answer is preselected. A section marked Problem requires a written note.
Photos are optional, up to three per report, compressed to JPEG on the phone.

The detailed PDF's 90 PSI target is not applied to every vehicle. The phone
guidance says to use the approved pressure for the selected truck; a
truck-specific pressure table requires confirmation against fleet requirements.
Equipment guidance covers winches and DEF where fitted. Selecting Good confirms
the applicable checks in a section, not that every truck has every accessory.

Truck fullness is required in Truck & dump body (step 4); fuel-tank level is
required in Dashboard (step 3). Both offer Empty, 1/4, 1/2, 3/4 and Full, with
no default selection. Fullness describes occupied cargo space at inspection
time, not the number of loads hauled. Both values survive draft recovery and
appear separately in review, the saved receipt and the printable OpsCenter
report. These observations do not change the separate calculated Fleet load
state or fuel-purchase records.

## Storage and verification

OpsCenter owns the inspection record. Reports live in protected runtime storage
at `data/fleet/truck-inspections`, outside the release checkout via its existing
data mount. `OPS_TRUCK_INSPECTION_DIR` can override this for isolated tests.
Each report is immutable, includes its schema version, device, selected truck,
declared inspector, initials, start time, receipt time, answers and photographs.
New reports use schema version 2 and require both levels. Historical version-1
reports without fullness display Not recorded; replaying their original request
returns the unchanged receipt. An unfinished old draft must record fullness
before its first submission.
The inspection date is the Chicago date at the recorded start time. Late reports
retain their original date. Drafts older than seven days cannot be submitted.

An exclusive hard link publishes a fully written report file. A repeated device
and request ID returns the same saved result; different content with the same
ID is rejected. The server reads the report back and links it into the daily
report index before acknowledging receipt. A GET by request ID recovers an
uncertain acknowledgement and repairs a missing daily index link. The browser
freezes a submitted report until it has a receipt. Retrying uses the same ID
and exact answers. The phone cannot overwrite a submitted inspection.

IndexedDB preserves an unfinished report and its photos on the same phone.
While a loaded page can continue without a connection, cold offline loading is
not supported. No background polling, automated resubmission or paid service is
added. A draft is not represented as received by OpsCenter. Photos and answers
remain on the phone until receipt is confirmed; the completed draft is then
removed. Users should keep the page open if device storage is unavailable.

## Access boundary

The dedicated public `inspect.junk-king.app` origin redirects `/` to the inspection
page and permits only the exact inspection page, manifest, icon,
`/api/truck-inspection` and Next assets. Management, authentication and webhook
routes return 404 on this origin. OpsCenter's Truck Check entry redirects here.
The hostname uses a proxied CNAME to the existing `opscenter-mission-control`
tunnel (`30d8a080-e2d1-4452-b463-4ba2ba8e57ba`). Its dedicated local ingress in
`~/.cloudflared/opscenter-mission-control.yml` forwards only this hostname to
the existing OpsCenter service at `http://127.0.0.1:3000`. Existing ops/hooks DNS
records and the shared tunnel remain unchanged. No new Worker, cloud
subscription or metered provider is used.

The old `hooks.junk-king.app/truck-inspection` address remains usable for existing
drafts and receipt recovery. Browser storage and phone cookies belong to their
origin; they are not copied across domains. Saved reports remain in OpsCenter.
Existing webhook routes are unchanged. OpsCenter's management origin serves `/fleet-inspections`.
The Crew Portal and its authentication are not modified.

The browser connects automatically with a random 256-bit key and a Secure,
HTTP-only, SameSite Strict cookie over HTTPS. The key is retained locally until
connection is confirmed so a retry returns the same device. Only its hash is
stored on the server. This connection identifies the phone for drafts and
receipt retrieval for 180 days; it does not assign a truck. Each report supplies
an explicit truck validated against the dispatch truck list. A phone can submit
successive reports for different trucks and retrieve its own receipts. Another
phone cannot retrieve those receipts, even when selecting the same truck.
Changing a submitted report's truck with the same request ID is rejected.

Existing phone cookies, report files and unfinished drafts remain compatible.
A pre-update loaded client that omits the truck can finish using its legacy
phone assignment. The updated app restores that truck only on an existing
unfinished legacy draft; new inspections always require a fresh selection.
Existing saved reports already contain their truck and are never reassigned.
Legacy pairing endpoints remain compatible but are not offered in the UI.

Anyone with the public app link can create an inspection-only connection. It
has no crew roster, payroll, management or report deletion access. Management
still requires the existing OpsCenter sign-in and role checks. Disconnect ends
the current connection, not access by a physical phone; it can connect again.
Report submission does not authorize dispatch or resolve a stop condition.
All POST handlers require JSON, bounded bodies and same-origin browser requests.

## OpsCenter review

Fleet links to Morning inspections. Managers can filter reports by date and
truck and status, select original reports and photos, and print the selected report.
The list places Do not operate reports first, then reported problems, missing
trucks and clear reports. All original reports remain available, including
multiple reports for a truck; the counts label reports separately from trucks. The summary
distinguishes trucks with a five-point report from trucks without one; a missing
report does not establish that a truck was scheduled to operate.
The historical daily/weekly/monthly checklist records remain separate. The
five-point report does not rewrite those answers or automatically resolve repair
work. A Do not operate report must be reviewed before operation; a later Good
inspection is not evidence of a repair. No dispatch action, supervisor signature,
repair resolution, email or Slack delivery is fabricated by submission.

## Validation

Run `npm run verify:truck-inspections`, relevant authentication/role tests,
TypeScript and production build checks. Use synthetic connected phones to test the
exact mobile flow, draft recovery, failed receipt recovery, repeat submission,
photo preservation, and management read-back. Production acceptance additionally
requires both the public phone origin and authenticated management view.

## Approved phone design

The Figma Truck Check design (file `nVwyzBhzVXidJcf5gdja7m`) is implemented
with the existing CSS module and a locally hosted Inter variable font (OFL
license in `public/fonts`). There is no external font request. The phone uses
large bottom actions, five labeled progress segments and direct fuel choices.
Good-and-next records one explicit result and advances; a short double-tap
guard prevents one tap sequence from accepting two different sections.
A problem opens a dedicated note/photo form with the section retained.

The final operating decision is a separate step, followed by editable review
and initials. No problems remains unavailable when a problem exists. Changing
a result clears the previous operating decision. Existing step-6 review drafts
continue to work; the new decision screen uses step 7. Uncertain submissions
show a separate receipt-pending screen and preserve the existing immutable
report recovery process. Success offers a full submitted-report read-back.

The five routine checklist screens use a compact section heading, the complete
checklist and side-by-side Good / Report a problem actions. Browser acceptance
checks each section at 393 × 650 and 375 × 650 usable pixels (excluding phone
browser bars): no page scrolling, no covered checklist or level choices, and
tap targets at least 44 pixels tall. Fuel and cargo fullness remain required.
Natural scrolling remains available for enlarged text, smaller screens, open
keyboards, photos and longer reports. The Figma sample data is not loaded into
the app.

## App identity

The banner and installed app are named Five Point Inspection. A gear-and-wrench
icon uses Junk King red `#EC2027`, gold `#E2C675`, black and white, with the
official Junk King crown, extracted from the existing vector brand artwork.
The icon omits the wordmark and tagline. Versioned crown-icon URLs allow browsers
to load the new artwork. The banner displays
the existing vector brand asset beside the app name and selected truck. The SVG
source is `lib/truck-inspection-icon.ts`; PNG home-screen variants are 180, 192
and 512 pixels. The 512-pixel icon has an opaque background and safe margins for
launcher masks. The page supplies its own Apple touch icon and favicon.
