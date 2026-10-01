# Dated crew roster

Schedule → Tomorrow → Crew roster selects the operating date. Set each active crew member to Scheduled, Off, or Pending. Scheduled staff require a Central-time start time and may be assigned to a truck or left Unassigned. Save roster persists that date only.

OpsCenter owns planned attendance. This does not change JunkWare appointment crews, payroll, or Waypoint phone enrollment. Saved attendance is available through `readScheduleCrewRoster(date)` and `morningCrewRoster(date)`; the latter returns scheduled staff only. WhatsApp delivery is a separate integration and is not activated by this feature.

The authenticated `/api/desktop/schedule/roster` endpoint returns names, truck choices, saved rows and version. The `schedule.crew-roster.save` action is implemented by `saveScheduleCrewRoster`, records actor and time, validates crew identities, and rejects a stale version. Durable immutable revisions live outside Git under `OPSCENTER_DATA_DIR` or `OPSBOT_DATA_DIR` in `schedule-crew-rosters`, with `OPS_CREW_ROSTER_DIR` as an override. Atomic revision publication and read-back verify saves. Missing storage returns an unsaved roster; corrupt or unavailable storage fails visibly.
