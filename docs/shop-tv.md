# Shop TV

Open **Command → Shop TV** from the desktop page rail. `?tv=1` is the compatible
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

Command and Crew refresh through the existing authenticated read endpoints every
30 seconds while visible. No collectors, integrations or provider calls are added.
Hidden tabs suspend polling; returning refreshes them. Failed reads retain the
last snapshot with an error/freshness notice. Motion respects reduced-motion
settings, and hovering the ticker pauses it.

Synthetic validation uses the existing aspect-ratio fixture with `tv=1` at
1920×1080. This page is an authenticated desktop presentation, not a public URL
or a new authentication mode. Keep shared shop screens within the intended
manager viewing audience.
