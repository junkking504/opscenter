# The Huddle

Open **Command → The Huddle** from the desktop page rail. `?tv=1` is the compatible
URL flag. It requires the existing manager/administrator desktop session and
always follows today's Chicago operating date, including midnight rollover.
Select **Full screen** for browser full-screen (a user gesture is required);
**Exit TV** returns to Command. No writes, workflow actions or OpsBot prompts are
exposed in this view.

The screen shows recorded revenue, the existing daily revenue goal, pace and
same-weekday-last-year comparison. The top five crew members are ranked by
credited revenue, with recorded-worked-hours RPH and dollar gap to first place.
Crew credit is not added to company revenue; payroll amounts are not displayed.
Missing hours produce a dash. Missing crew dates prevent a leaderboard.
The completion ticker uses completed jobs in Command's existing source snapshot,
not estimates or GPS proximity. Source timestamps, incomplete coverage and stale
revenue states remain visible. Recorded revenue is not verified cash collected.
Completed statuses may include JunkWare's recorded-duration suffix; that suffix
does not exclude a completed job from the ticker. Estimates, cancellations and
unconfirmed completion text remain excluded.

Command and Crew refresh through the existing authenticated read endpoints every
30 seconds while visible. No collectors, integrations or provider calls are added.
Hidden tabs suspend polling; returning refreshes them. Failed reads retain the
last snapshot with an error/freshness notice. Motion respects reduced-motion
settings, and hovering the ticker pauses it.

Synthetic validation uses the existing aspect-ratio fixture with `tv=1` at
1920×1080. This page is an authenticated desktop presentation, not a public URL
or a new authentication mode. Keep shared shop screens within the intended
manager viewing audience.

## The Huddle celebration board

The navigation and visible screen name is now **The Huddle**. Existing `tv=1`
and `commandView=tv` links remain compatible.

The daily goal and crew ranking stay visible beside a rotating crew spotlight.
Truck showdown ranks source-confirmed completed jobs by count, then recorded
job revenue, with completed-job average ticket. Each job counts once; missing
prices leave truck revenue and average ticket unavailable. Four trucks appear
at a time and pages rotate so every eligible truck appears. Stale schedules
suppress standings. Crew credit is never summed into truck totals.

`GET /api/desktop/tv` is an authenticated local read for today's Chicago date.
It projects recent five-star reviews from saved Podium snapshots, names crews
only for matched attribution, and checks month-to-date saved crew history for
new daily credited-revenue records. Incomplete daily coverage or unknown prior
revenue prevents a personal record. These are recorded month-to-date bests,
not all-time bests. Reviews are limited to 30 days and show source timestamps;
feeds over 24 hours old are flagged. No provider refresh is triggered.

Spotlights rotate every 15 seconds with Pause and Next controls. Reduced-motion
preferences use manual rotation. The local spotlight projection refreshes once
per minute while visible; existing Command/Crew refresh remains 30 seconds.

Birthdays, anniversaries, welcomes, actual contests and photo wins use optional
manager-curated JSON at `$OPSBOT_DATA_DIR/shop-tv/celebrations.json`. No birthdays,
prizes, contest rules, employee notes or customer photos are inferred. There is
no content editor in this version. Example schema (fictional content):

```json
[{"kind":"welcome","title":"Welcome to the crew!","body":"Have a great first week.","credit":"Example teammate","start":"2026-10-19","end":"2026-10-23"}]
```

Kinds: `birthday`, `anniversary`, `welcome`, `contest`, `win`. Both dates must be
valid and include the current day. Keep sensitive details out of wall-display
text. For an approved paired cleanup photo, include `appointmentId`, `before`
and `after`; both must pass existing JunkWare media and appointment-identity
validation. The manager chooses the pair and credits; the system does not infer
which images represent before/after. Missing content is shown as waiting, never
replaced with an invented celebration. Invalid/oversized files report unavailable.
