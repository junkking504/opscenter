# Estimate follow-up

Schedule → Estimates is a persistent workspace across dates. Command links to
overdue follow-ups, callbacks due today, unassigned estimates, and booking review.
Counts cover the current and prior calendar months plus every estimate with saved
OpsCenter follow-up history; All available history exposes older records.

The queue reads existing JunkWare raw daily archives and the verified current /
next-day schedule observations. It starts from completed Estimate appointments,
chooses the latest observation per appointment ID, and matches non-canceled Jobs
using `source_estimate_appointment_id`. Conversion of the same appointment ID into
a Job also counts. Scheduled and completed Jobs both qualify. Canceled linked
Jobs return to review; matching names, phones, addresses or JK references are
never proof of conversion. Exact phone/address/JK matches are review suggestions.

Without a linked Job, the initial state is Verify booking. Historical/future
coverage may be incomplete or stale. This is a review queue, not a certified
unconverted-opportunity total. Source notes retain declines, booking intentions,
duplicate quote context and earlier contact. No notes automatically mark a sale
lost or imply a booking. Missing quote totals remain unavailable; zero remains
zero. Quoted amounts are never summed into revenue. Dates are appointment dates,
which can differ from original quote dates after rescheduling.

OpsCenter owns the follow-up disposition, owner, next date, reason, contact notes,
and timestamped actor history. Needs follow-up and Waiting on customer require
one owner and a dated next action. Lost requires a reason and clears the next
date. Reopening preserves history. A source-linked conversion takes precedence
over a local disposition without deleting that history. Every contact is an
explicit operator entry; opening telephone or email links does not record contact.

The authenticated `/api/desktop/estimates` endpoint requires operations read or
write permission and same-origin writes. Saves check the displayed source/local
version, serialize through a filesystem lock, atomically persist and read back
private state, and retain actor-bound request IDs for idempotent retries. Source
observation timestamps alone do not invalidate a draft. Corrupt history fails
closed; a crash lock requires inspection. Data lives at
`$OPSBOT_DATA_DIR/estimate-follow-up/state.json` (default: the existing private
OpsBot data directory), outside releases and Git. Do not remove this history
during deployment or workspace cleanup.

Schedule job in JunkWare opens the original estimate's source record. The user
completes the booking in JunkWare, which preserves the source relationship.
Reload records rechecks collected evidence; it does not start a new provider
request. OpsCenter only shows Converted after the source link or same-ID type
change is observed. This release does not implement a new JunkWare booking
writer or send any messages. Existing collectors and provider request volume are
unchanged. Command summarizes current follow-up dates even when an older operating
day is selected; its label identifies the cross-date scope.

Validation: `npm run verify:estimates`, desktop type/build, focused browser tests,
and the normal production build. Browser fixtures use synthetic records and
mocked API responses; no customer record or source appointment is changed by QA.
