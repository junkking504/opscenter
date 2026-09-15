# Five-point morning inspections

The dedicated company truck phone opens `/truck-inspection` and chooses its
truck once. No setup code or employee login is required. The phone remembers
that selection for 180 days, unless browser data is cleared or the connection
is disconnected. Existing connected phones keep their truck and drafts. Each morning, the inspector
enters their own name and mileage, checks five sections, records fuel, chooses
a final operating status and initials the report. Names are declarations on a
shared company device, not proof of an individual login. Inspectors enter their names directly; the public phone API does not expose the crew roster.

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

## Storage and verification

OpsCenter owns the inspection record. Reports live in protected runtime storage
at `data/fleet/truck-inspections`, outside the release checkout via its existing
data mount. `OPS_TRUCK_INSPECTION_DIR` can override this for isolated tests.
Each report is immutable, includes its schema version, device, assigned truck,
declared inspector, initials, start time, receipt time, answers and photographs.
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

The existing public `hooks.junk-king.app` origin serves only the exact inspection
page, manifest, icon and `/api/truck-inspection` routes, plus the existing
webhook routes and Next assets. Its management routes remain unavailable.
No new Worker, DNS record, tunnel, KV namespace, cloud subscription or provider
request is required. OpsCenter's management origin serves `/fleet-inspections`.
The Crew Portal and its authentication are not modified.

An unconnected phone receives only the fixed dispatch truck choices. A connection
POST validates the selected truck and installs a 256-bit random, HTTP-only,
SameSite Strict cookie that is Secure over HTTPS. The browser generates and
retains the random connection key until a successful connection is verified;
retries reuse the key and return the same device. Only its hash is stored on the
server. An existing active connection cannot be reassigned by a connect POST.
It grants submission and receipt access for that device only, with no crew
roster, payroll, management, other-device reports or deletion access.

Truck selection is a declaration on the phone, not manager approval or proof
that the device is company-owned. Anyone with the public app link can create
an inspection-only connection. Report content still requires supervisor review;
submission does not authorize dispatch or resolve a stop condition. Management
stays behind the existing OpsCenter sign-in and role checks. Disconnect revokes
the current connection, not the physical phone; the phone can connect again.
Existing code-paired cookies and legacy pairing endpoints remain compatible,
but neither the phone nor management UI asks for or generates setup codes.
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

The fixed Figma frames become naturally scrolling content with sticky bottom
actions in the app, preserving access on short screens, enlarged text and open
phone keyboards. The Figma sample data is not loaded into the app.
