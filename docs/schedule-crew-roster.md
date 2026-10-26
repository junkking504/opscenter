# Dated crew roster

Schedule → Tomorrow → Crew roster selects the operating date. Set each active crew member to Scheduled, Off, or Pending. Scheduled staff require a Central-time start time and may be assigned to a truck or left Unassigned. Save roster persists that date only.

OpsCenter owns planned attendance. This does not change JunkWare appointment crews, payroll, or Waypoint phone enrollment. Saved attendance is available through `readScheduleCrewRoster(date)` and `morningCrewRoster(date)`; the latter returns scheduled staff only. WhatsApp delivery is a separate integration and is not activated by this feature.

The authenticated `/api/desktop/schedule/roster` endpoint returns names, truck choices, saved rows and version. The `schedule.crew-roster.save` action is implemented by `saveScheduleCrewRoster`, records actor and time, validates crew identities, and rejects a stale version. Durable immutable revisions live outside Git under `OPSCENTER_DATA_DIR` or `OPSBOT_DATA_DIR` in `schedule-crew-rosters`, with `OPS_CREW_ROSTER_DIR` as an override. Atomic revision publication and read-back verify saves. Missing storage returns an unsaved roster; corrupt or unavailable storage fails visibly.


## Compact editor

The roster keeps each person's name and attendance together. Pending and Off
rows omit the inactive truck and time fields. Scheduled rows expose a truck
choice and a labeled time button; its quick choices are 7:00, 7:15 and 7:30 AM,
with a native custom-time field for any other minute. All times remain Central
wall-clock `HH:mm` values; choosing a time only edits the local draft.

The header and Save roster area remain visible while the member list scrolls.
Close and Escape ask before discarding changed rows, and leaving the document
with an open unsaved draft invokes the browser's standard warning. Saves remain
explicit, use the version returned when opening the roster, and stay pinned to
that opening date even if a parent date prop changes. Server validation, access
checks, storage, assignment semantics and notification behavior are unchanged.

`node scripts/test-roster-compact-browser.mjs` uses isolated synthetic responses
for phone/desktop layouts, both themes, quick/custom times, read-only mode,
missing times, conflicting saves, repeated actions, dismissal and opening-date
isolation. It never calls the live roster endpoint. Physical handset acceptance
remains separate from emulated browser touch coverage.
