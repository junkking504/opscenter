# Five-point morning inspections

The company truck phone opens `/truck-inspection`. A manager creates a
single-use setup code in `/fleet-inspections`, assigning the phone to one truck.
The phone remembers that assignment for 180 days. Each morning, the inspector
enters their own name and mileage, checks five sections, records fuel, chooses
a final operating status and initials the report. Names are declarations on a
shared company device, not proof of an individual login. Crew roster names are
suggestions; an inspector whose name is not listed can enter their name.

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

Setup requires a manager's existing OpsCenter session. Setup codes contain 96
random bits, expire after 24 hours and can be consumed once. The resulting
phone cookie contains 256 random bits, is HTTP-only, SameSite Strict, and Secure
over HTTPS. Only its hash is stored. It grants submission and receipt access for
that device and truck, and the active crew names; no payroll, management,
other-device report, truck reassignment or deletion access. Managers can revoke
devices. Reconnect a new phone through a new code; revoke the old phone.
All POST handlers require JSON, bounded bodies and same-origin browser requests.

## OpsCenter review

Fleet links to Morning inspections. Managers can filter reports by date and
truck, open original reports and photos, and print open reports. The summary
distinguishes trucks with a five-point report from trucks without one; a missing
report does not establish that a truck was scheduled to operate.
The historical daily/weekly/monthly checklist records remain separate. The
five-point report does not rewrite those answers or automatically resolve repair
work. A Do not operate report must be reviewed before operation; a later Good
inspection is not evidence of a repair. No dispatch action, supervisor signature,
repair resolution, email or Slack delivery is fabricated by submission.

## Validation

Run `npm run verify:truck-inspections`, relevant authentication/role tests,
TypeScript and production build checks. Use synthetic paired phones to test the
exact mobile flow, draft recovery, failed receipt recovery, repeat submission,
photo preservation, and management read-back. Production acceptance additionally
requires both the public phone origin and authenticated management view.
