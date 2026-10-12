# Approximate visit release handoff

Implementation date: October 12, 2026. This is a local, unshipped change based on
production `5170718108219b42bd27b0fd152d9a0c79b8af6e`. The active release and
canonical checkout were inspected; unrelated edits in `repository/` were
preserved. Worktree: `worktrees/approximate-arrival-departure-20261012`, branch
`codex/approximate-arrival-departure-20261012`.

## Expected effect

After approved activation, new GPS observations near an eligible approximate
pin can produce an arrival and a subsequently corroborated departure. This
applies to cached best-match pins, including a building/entrance fallback for a
bare numeric unit. It does not prove that an individual reported missed arrival
was caused by the former exclusion or guarantee which current pin a live record
will select. No named appointment was manually marked, source timestamps were
not fabricated, and no historical event replay was performed.

Coordinates remain approximate. Alerts show the provider/candidate address;
Schedule visit blocks show ≈ and accessible Approximate pin text. Overlapping
circles involving approximate pins (centres within 400m) suppress matches,
including nearby completed appointments. This conservative choice can leave a
dense complex unmatched until evidence distinguishes its appointments. No new
provider calls, paid services, or spending permissions are introduced.

The first normal matcher run after activation creates a durable prospective
cutoff in external `data/config/approximate-visit-policy.json`; earlier GPS is
excluded from new approximate matches. Do not run the matcher manually, remove
that file, or change the cutoff to backfill this incident. Existing publication
fingerprints continue to deduplicate arrivals and departures. No collector
source file needs installation: the existing runners use the release-owned
adapter with checked anchors against the installed OpsBot matcher.

## Validation

Completed locally: the synthetic approximate-visit suite and listed regression
checks passed, both TypeScript projects passed, targeted ESLint passed with no
output, `git diff --check` passed, and the final `npm run build` completed. Build
output retained existing bundler/deprecation warnings.

Use synthetic fixtures only:

```sh
npm run verify:approximate-visits
node --import tsx scripts/test-schedule-gps-presence.ts
node --import tsx scripts/test-desktop-schedule-visits.ts
node --import tsx scripts/test-appointment-position-tracking.ts
node --import tsx scripts/test-visit-tracking-agent.ts
node --import tsx scripts/test-appointment-visit-alerts.ts
node --import tsx scripts/test-gps-visit-assignment.ts
node --import tsx scripts/test-approximate-eta.ts
node --import tsx scripts/test-slack-alerts.ts
node node_modules/typescript/bin/tsc --noEmit --incremental false
node desktop-ui/node_modules/typescript/bin/tsc --project desktop-ui/tsconfig.json --noEmit --incremental false
```

The Python regression reads installed matcher/validator *source* but injects
synthetic appointments, tracker mappings, temporary input directories, an
activation time, and mocked JSON/CSV output writers. The real cutoff helper is
tested only in a temporary directory. The TypeScript test builds notifications
without sending them and renders a synthetic Schedule block on the server.
Cached-provider and bare-unit tests use temporary provider responses, with no
network/geocoding calls.

`test-schedule-truck-visits.ts:89` fails its pre-existing “Every named travel
card occupies its own slot” assertion, identically on the unchanged base release
and this task branch. Its preceding visit interval tests pass. This unrelated
layout failure has not been changed or hidden. Authenticated production browser
behavior and physical handset acceptance have not been tested for this code.

## Deployment: execute only after explicit owner approval

The owner must approve **publishing to production and activating the release**.
Nothing below was executed for this implementation. Production can move before
approval: merge its latest state, revalidate, and review any conflicts before
publishing. Do not reset/force-push production or invoke a task branch controller.

From this retained task worktree:

```sh
cd /Users/missioncontrol/opscenter-v2/worktrees/approximate-arrival-departure-20261012
git status --short
git fetch origin
active_sha=$(git -C /Users/missioncontrol/opscenter-v2/opscenter rev-parse HEAD)
git merge --no-edit origin/production
git merge-base --is-ancestor "$active_sha" HEAD
```

Stop if the ancestry check fails or if merge conflicts need review. Re-run the
synthetic checks above, targeted lint, and `npm run build` with temporary/empty
data paths as in the task build evidence. Confirm the active SHA has not moved
again before the authorized push. Review the full `origin/production..HEAD`
delta; do not include unrelated changes. The following push can itself trigger
production automation, so it is part of the approval boundary:

```sh
git push origin HEAD:production
./deploy/macmini/deploy-from-macbook.sh missioncontrol@JK--Mission-Control.local origin/production
```

The launcher uses the existing installed controller, its spending gate and
release lock; it requires the selected commit to be the current
`origin/production` head and contain the active release. Do not reinstall the
controller, alter its allowlist, bypass a lock, manually run the matcher, or
replay historic dates for this change. If another deployment already activated
the exact approved commit, verify it instead of activating twice.

After controller completion, independently verify the active release SHA,
service health, and authenticated Control/Schedule behavior. Read the cutoff
file and new visit provenance read-only; do not edit them. Validate the next
naturally occurring, unambiguous approximate-pin arrival and departure from
fresh GPS, including the visible Approximate marker and one alert per
transition. Check stale GPS and nearby appointments remain guarded. Physical
handset acceptance requires an actual device/crew check; a build or desktop
browser result is not that evidence.

Retain this unpushed worktree until publishing/activation is approved and
verified. Only then follow `docs/workspace-retention.md` from outside the
worktree. No temporary server was started by this task. Dependency symlinks
reuse the base release's installed packages and must not be committed.
