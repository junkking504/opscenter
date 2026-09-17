# Visit and unload/cost agents

OpsCenter runs two deterministic local agents using existing collected evidence.
They have separate responsibilities and add no AI calls, provider requests,
service, daemon, or Slack messages.

1. **Visit tracking** owns geofence and appointment arrivals/departures, source
   confidence, bounded departures and visit identity. Its result contains no
   costs or truck-load mutations. See [LinxUp GPS](linxup-push.md).
2. **Unload/cost** consumes that exact visit result. Disposal and metal-yard
   arrivals create one projected unload at original arrival. Dump visits also
   create the configured assumed minimum, replaced by a uniquely matching actual
   whenever recorded. See [dump expenses](dump-expenses.md).

## Autonomous local execution

The existing minute LinxUp refresh invokes `scripts/run-operational-agents.py`
after draining accepted pushes and before reachability or V2 checks. It runs
again on refresh completion; accepted V3 processing also invokes it on completion,
even when a later appointment-processing command fails. These are local reads;
the agents continue while the UI is closed and V2 certificate checks fail.

The Python wrapper obtains a permanent OS `flock`, then runs the Node projection
with a 20-second bound. The lock releases on process exit/crash and its inode is
never deleted. A busy owner leaves processing for the next existing tick.

State is outside Git at `data/fleet/agents/YYYY-MM-DD.json` with mode 0600:
separate agent statuses, heartbeat, last success, source watermarks, dependency
freshness, provenance and results. File replacement is atomic and synchronized.
The runner rejects an older run timestamp or regressed source evidence. GPS,
appointment and verified expense observation timestamps are tracked independently,
so a late actual correction can reconcile while GPS remains unchanged.

If tracking fails, its prior successful visits remain marked stale; the cost
agent can still reconcile new actuals against those visits. It cannot infer new
unloads from that failure. A cost-agent failure retains its own last result while
tracking continues. Incomplete provider coverage is explicitly degraded. Only the
current day and adjacent local snapshots are read, never the full load history.

On-demand Command, Capital and truck-load views use the same pure projections.
Neither agent edits provider records, authoritative accounting, or the saved
truck-load ledger. The persisted output provides the autonomous heartbeat and
inspectable decision state, while current reads avoid waiting for the next tick.

Validation: `npm run verify:visit-tracking`, `npm run verify:dump-expenses`,
`npm run verify:truck-load-status`, and the existing LinxUp refresh/lock tests.

## Dedicated address verification

The independent [address verification agent](address-verification-agent.md) owns
the address worklist and verified locations. It has a separate one-minute
schedule, OS lock and request budget. Visit tracking consumes its coordinates
and correction intents; neither the address worker nor visit replay sends
messages or modifies operational provider records.
