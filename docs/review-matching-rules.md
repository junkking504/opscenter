# Review matching rules

Status: agreed with the owner on 2026-10-21. This file is the source of truth for
matching Google reviews (via Podium) to completed JunkWare jobs and crew. Code,
tests and reviews are checked against it. If the code disagrees with this file,
the code is wrong, or this file must be updated first with the owner's approval.

## Goal

For every review, find the completed job it is about, so the right crew gets
credit. A match is judged correct when it is the job a manager would confirm.
Success is measured on the evaluation set (below): the confirmed job ranks
first.

## Candidates

- Completed, non-estimate jobs with recorded crew.
- Window: jobs completed from 14 days before the review up to the review time.
  Widen to 90 days only when no candidate in the 14-day window scores at least
  Medium.
- Chronology (amended 2026-10-21 after review of the first build): a job is
  eligible if its recorded completion time is no later than the review time plus
  a tolerance. Crews often close a job a few minutes after the customer posts
  (the first confirmed case completed 204 seconds after its review). Default
  tolerance is 6 hours until measured; replace it with the 99th percentile of
  (completion time minus review time) over reviews that already have an exact
  phone/email match, capped at 12 hours. Jobs completed later than that are
  never candidates. A job completed after the review earns the same-day timing
  points only if it completed on the same Chicago calendar day.
- Unknown completion time on the review's Chicago date: eligible, but capped at
  Medium (never High) and no timing points beyond the 1–3 day band.

## Signals

Owner decision (2026-10-21): suggestions may use customer email handles and job
notes. These values are read inside OpsCenter only. They are never written to
the assignment record, receipts, logs, test output, the vault or chat.

Points are a starting point; tune them only against the evaluation set.

| # | Signal | Points |
|---|--------|--------|
| 1 | Podium invite phone or email exactly equals the job's phone/email | automatic (existing path) |
| 2 | Reviewer name equals the Podium invite's `customerName`, and that name matches the job customer | +60 |
| 3 | Customer name: exact / first+last | +50 |
|   | Customer name: name + initial | +35 |
|   | Customer name: nickname or 1–2 letter spelling variant of first and last | +30 |
|   | Customer name: first name only, or last name only | +15 |
| 4 | Reviewer surname or full name appears in the customer email handle (e.g. reviewer "Jane Doe", email `jdoe…@`), covering married/maiden names and spouses | +35 |
| 5 | Timing: job completed same day as the review | +30 |
|   | 1–3 days before | +20 |
|   | 4–7 days before | +10 |
|   | 8–14 days before | +3 |
|   | older than 14 days | 0 |
| 6 | Review text overlaps job notes, business/property name, or service street/neighbourhood (ignore stop words and generic junk-removal words) | +10 per distinct overlap, max +20 |
| 7 | Review mentions a crew first name or known nickname on that job (existing guarded tokenizer) | +15, max +25 |
| 8 | Same territory/location | +5 |

Rules on combining:
- Crew mention (7) and territory (8) only boost a job that already has at least
  one of signals 2–6. On their own they never produce a suggestion, unless that
  crew member did exactly one job at that location in the 14-day window.
- A first-name-only match (15) needs timing (5) or another signal to reach
  Medium.

## Confidence bands

- **High** (auto-save): score ≥ 80, AND at least one identity signal
  (1, 2, 3 exact/first+last/initial, or 4), AND timing ≤ 3 days, AND the next
  best candidate in the whole eligible pool (not only the 14-day window) is at
  least 25 points lower.
- **Medium**: score 40–79, or High score without the margin. Shown first with
  reasons; one click to confirm.
- **Low**: score 15–39. Shown below Medium, at most 3.
- Below 15: not shown.

## Saving

Owner decision (2026-10-21): High-confidence matches are saved automatically.

- Auto-saved matches use `matchMethod: "inferred_high"`, record the score,
  reasons and rules version, and count for crew credit.
- The review card shows "Auto-matched" with the reasons and a one-click
  change/undo. A manager's confirm or change always wins and is never
  overwritten by a later automatic run.
- Automatic runs never replace an existing manual assignment or an
  `exact_phone`/`exact_email` match.
- Medium and Low always wait for a manager.

## Evaluation set

- Built from manager-confirmed assignments. Names, emails, phones, notes and
  addresses are replaced with consistent fake values that keep the same
  relationships (same initials, handle overlap, time gap, matching keyword).
- No real customer values are committed to Git or printed by tests.
- The test reports top-1 and top-3 accuracy and the number of High
  auto-saves that disagree with the confirmed job. Any wrong High auto-save
  fails the test.
- Every new manager confirmation can be added to the set; cases where the
  confirmed job was not ranked first are listed for the next tuning pass.

## Worked examples

Use JK numbers only in shared notes.

- JK4122903 (reviewed 2026-10-20 evening). The reviewer's surname appears in
  the job's customer email handle (4), the review mentions a storage facility
  and area that appear in the job notes (6), and the job was booked and
  completed the same day (5). Expected: High.
- JK4117371. The reviewer's first name matches the customer (3, first only),
  and the review names a crew member recorded on the job (7). Expected: ranked first (Medium or Low,
  depending on timing); never auto-saved.
