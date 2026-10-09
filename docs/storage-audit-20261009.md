# October 9 storage audit

The installed retention helper was run in dry-run mode across production,
preview and task worktrees before the policy-only cleanup resumed. The detailed
directory inventory and machine-local receipts are attached to the health
handoff outside Git; they contain sizes, retention reasons and exact candidates.

The production directory count exceeds three because the policy preserves
incomplete build source and directories referenced by running processes. A
directory count is not a count of complete usable rollback builds. At audit,
the remaining production directories comprised three protected current/rollback
copies, one additional process-referenced copy, three eligible superseded
releases, and twelve incomplete-build source remnants. Both preview copies were
protected by normal retention.

The dry run authorized 219 generated directories, including caches in 80 idle
task copies, and three superseded release worktrees. Only the installed helper
may apply these actions; do not delete source remnants or stop other tasks to
meet the 30 GB attention threshold. The helper repeats process/path checks
before each deletion, so applied counts can differ from the dry run.

Checks: `npm run verify:workspace-retention` passed all 22 cases;
`npm run verify:production-release-gate` passed. No retention policy or helper
code changed. A daily read-only disk-space check is configured for 08:00 Central,
reporting meaningful changes and newly actionable conditions.
