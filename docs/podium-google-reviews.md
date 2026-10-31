# Podium Google Reviews integration

OpsCenter uses Podium as the authoritative read-only feed for Google reviews.
Podium returns reviews newest first and identifies the original review site, so
the collector filters to `Google` without relying on the limited Google Places
sample. Marketing → Reviews shows each active Podium location separately,
including rating, total count, newest reviews, low ratings, and reviews that
still need a response.

## Access and OAuth

Create a private Podium developer application with this exact redirect URI:

```text
https://ops.junk-king.app/api/integrations/podium/callback
```

Request only `read_reviews` and `read_locations`. No message, contact, payment,
review-write, or response-write scope is required. Podium developer access is
requested at `https://developer.podium.com/`; its application should describe
the use case as a current Podium customer reading its own Google review data for
an internal operations dashboard.

Store credentials in the Mission Control login Keychain under account
`opscenter`:

```text
com.opscenter.podium-client-id
com.opscenter.podium-client-secret
com.opscenter.podium-token-encryption-key
```

The encryption key must be 32 random bytes encoded as base64 or 64 hexadecimal
characters. Never write these values to Git, chat, logs, or a Business share.
The OAuth refresh token is encrypted with AES-256-GCM at
`~/Library/Application Support/OpsCenter/podium/tokens.json`.

After deploying the integration, authorize it from Marketing → Reviews or:

```text
https://ops.junk-king.app/api/integrations/podium/connect
```

Only an OpsCenter administrator can start or complete the OAuth route.

## Collection and verification

The collector writes verified snapshots outside Git:

```text
data/podium-google-reviews/current.json
data/history/podium-google-reviews/podium-google-reviews_YYYY-MM-DD.json
```

Run and verify the first collection before installing the schedule:

```sh
npm run collect:podium-reviews -- --data-dir /Users/missioncontrol/.openclaw/workspace/opsbot/data
npm run verify:podium-reviews
./deploy/macmini/install-podium-reviews-collector.sh
```

The dedicated LaunchAgent checks every minute with the minimum-age skip disabled.
The Campaign page reads the latest snapshot every 30 seconds while visible and
not editing a job match. Reviews appear after Podium exposes them; this is
polling, not an instant Google event feed. A failed request preserves
the last verified snapshot; it never substitutes a partial result. Production
deployment restarts the collector only after it has been explicitly installed.

## Appointment and crew attribution

The canonical [review matching rules](review-matching-rules.md) define candidate
eligibility, signals, confidence bands, precedence, saving and evaluation. Keep
that owner-approved spec unchanged unless the owner approves a rules change.
The guarded capitalized crew-name tokenizer remains separate from customer-name
fuzziness; contractions and ambiguous common-word names retain their guards.

### Local sources and privacy

`lib/podium-review-attribution.ts` starts with completed daily-metrics appointments
and recorded crew. It joins `history/junkware/junkware_YYYY-MM-DD_raw.json`
appointments/completed rows by appointment ID and compatible JK number to read
completion time, customer email, notes, business/property and service-area text.
Metrics remain authoritative for crew, truck and normalized territory. Explicit
completion time determines the completion date; when unavailable, a completion
date or the completed daily-metrics date is used. Same-day date-only records
remain eligible with at most 20 timing points and Medium confidence. Known completion may follow the review within the measured
tolerance; cross-midnight later completion earns no timing points.
JunkWare wall-clock completion values are interpreted in America/Chicago, not
the server's timezone. An unreadable input file suppresses suggestions rather
than allowing a partial candidate pool to produce a false High margin.

Raw signal values remain in local memory. Reasons describe signal categories and
counts, never the email handle, matching note words or address. The collector
retains only appointment references for the invite-name signal, using invites
already fetched under its existing limits; no new provider requests are added.
Existing exact matches are retained across refreshes. Desktop reads only project
saved state and suggestions; they never perform automatic writes.

### Saving and rollout

Assignments live in `data/operator/podium_review_assignments.json` outside Git.
The collector can save High results with `inferred_high`, score, safe reasons
and rules version. Automatic and manager writes share an exclusive store lock
and atomic rename. Corrupt stores fail closed. Manual assignments and durable
`manual_unassigned` undo records always win; exact collector matches take
precedence over inferred matches. Automatic runs do not replace prior decisions.
The desktop **Auto-matched** label displays reasons and provides **Undo
auto-match**. Undo and one-click candidate confirmation use the existing
manager-only, version-checked commercial receipt path. A pending or uncertain
receipt blocks further changes and is checked without replaying the write.

**High auto-save defaults off.** `PODIUM_REVIEW_HIGH_AUTO_SAVE=true` is the
collector's activation switch. Keep it unset/false in production until Claude's
`review.md` approves the exact feature HEAD and that reviewed source is deployed
through the installed controller, measured wrong-High results are reviewed, and
the owner explicitly approves activation. Enable only for the deployed
collector; a worktree dry run or desktop request must never activate it. This task changes
neither production environment nor collector scheduling. Disabling the switch
stops future automatic saves; existing decisions and undo records remain intact.
Assignment locks publish PID, creation time and a unique owner marker atomically.
After five minutes, a dead PID (ESRCH) permits recovery; an active or unknown PID
is never evicted by age. Old empty legacy locks can also recover. Unknown or
malformed nonempty locks remain blocked. Any auto-save failure logs a fixed,
data-free warning and still writes the collected history/current snapshots.

### Evaluation and dry run

`npm run verify:podium-reviews` includes signal/safety tests and the evaluation
in `scripts/test-review-matching-evaluation.ts`. The evaluation separates one
anonymized manager-confirmed pair from synthetic worked examples and edge cases;
it is a regression set, not an estimate of population accuracy. The confirmed
pair preserves initials, name equality, crew mentions and the completion gap.
Its recorded completion is 204 seconds after the review and is now eligible.
The unchanged email-handle evidence makes this focused pair High under the
scoring table; the worked-example statement that it must never auto-save needs
planner reconciliation. Auto-save remains off. The separate first-name/crew-only
example remains Medium. No weights or private relationships were changed.

`scripts/evaluate-review-matching-exact.ts --data-dir <local data>` reads the
current snapshot and reports aggregates only. It deduplicates exact_phone/email
reviews by UID, uses appointment ID (JK only if no ID) as the label, and measures
inferred top-1/top-3 and High disagreements independently of that label. Missing
labels count as misses; completion-delay percentiles use every resolved usable
label **before** chronology filtering, including negative delays. Percentiles use
nearest rank, with tolerance bounded to 0–12 hours (6 hours if no usable labels).
Candidate completion coverage is the unique union of eligible, recorded-crew
90-day candidates across the exact cohort, before score/window pruning.

On 2026-10-21, 57 exact labels gave a p99 delay of 6,612 seconds (1h 50m 12s),
now fixed as `REVIEW_COMPLETION_TOLERANCE_MS`. All 57 resolved; top-1 was 56/57,
top-3 57/57, and 41 High had zero disagreements. All 1,390 eligible candidates
had usable completion times. Full percentiles and snapshot time are in the task
handoff. This is an existing-exact-match cohort, not a random sample or holdout;
zero observed wrong High does not establish accuracy for unmatched reviews.

For the historical comparison, extract `lib/podium-review-attribution.ts` from
base `4ce90d55` to a temporary `.ts` file and pass its absolute path with
`--baseline-module` to the evaluation script. The old matcher has no High
auto-save, so its wrong-High count is zero by construction.

Read current local data without collecting or writing:

```sh
node --import tsx scripts/dry-run-review-matching.ts --data-dir /path/to/opsbot/data
```

Only snapshot time, location and aggregate top-candidate band counts are printed.
Counts cover all loaded reviews, including ones already assigned; they are not
a count of new saves. No customer values, raw notes or contact data are emitted.

## Campaign review navigation

The desktop **Reviews** tab uses a queue beside the full review and job match.
Quick filters show all collected reviews, reviews Podium explicitly flags as
needing response, and reviews without a confirmed job match. Search covers the
reviewer, feedback, job number and recorded crew. Location, exact star rating,
and date order combine with those queues. Twenty reviews appear per page; the
queue scrolls independently on desktop, while phones show the selected review
with a back button that preserves the filters.

Crew credit is displayed for saved manual, exact and High inferred attribution.
Campaign and legacy review cards label inferred credit **Auto-matched**; legacy
employee/team totals show the auto-matched count, and Shop TV marks inferred
crew credit. These displays use `matchMethod`, never `assignedBy`, as authority.
The original-review link opens the source for reading/responding; Campaign does not post a reply.
Managers can confirm a displayed candidate in one click, or enter a completed appointment ID or JK job number,
open the appointment for review, and confirm that selection in a separate dialog.
Uncertain saves stay attached to their receipt and block repeat submissions;
**Check saved result** reads the original receipt without replaying the write.

Counts describe the loaded Podium snapshot (latest 100 reviews per location),
not all historical reviews. SearchKings failure does not hide available reviews.
Review-history zeroes are emitted only for fully completed dates covered by every
location's retained latest-100 window. Dates outside that common retained window
remain unavailable rather than being guessed as zero.
The synthetic Campaign fixture documented in [SearchKings integration](searchkings-integration.md)
exercises attribution and uncertain receipt recovery without live writes.

### Manual attribution context

The manual review dialog records an optional attribution context note (up to
2,000 characters) and either a confirmed or possible match. A possible match
requires an explanation and is stored as `ambiguous` with `manual_appointment`,
the selected completed appointment and recorded crew. It remains in the
unassigned/Check These queues and is excluded from confirmed credit totals.
Manual possible decisions survive collector refreshes without being auto-saved
over. Confirmation is an explicit later manager action.

The versioned `review.assign` operation accepts `confidence` (`confirmed` or
`possible`) and `evidenceNote`, includes them in its receipt, and verifies their
readback. Existing callers without these fields retain confirmed assignment
behavior. Campaign displays the context for both kinds of manual decision;
The Huddle labels tentative crew as **Possible match** and exposes the note
under **Attribution context**. Notes are internal operational evidence and must
not include credentials or unnecessary contact/payment details.
