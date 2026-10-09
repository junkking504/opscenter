# Slack “Incomplete” — read-only investigation, October 9

The specific production cause and historical frequency are **unavailable from
retained evidence**. Rate-limited replies remain a hypothesis, not a finding.
No Slack API request, Command refresh, token lookup or new polling was used for
this investigation. No application behavior was changed.

## Evidence

Reviewed `lib/slack-digest.ts`, `lib/desktop-command.ts`, the Command route and
Slack integration documentation at production lineage `85339006`.

- Channel history failure returns `ok:false`; the digest can still be `ready`
  and incomplete if another channel succeeds.
- Any failed replies call sets `complete=false` but discards its error, returning
  `rateLimited:false` from the channel. Thus even a real reply rate limit cannot
  be recovered from the returned channel result.
- Either history or replies `has_more:true` with no cursor also produces the
  same incomplete result.
- `detail` is only emitted when **zero** channels are readable. Partial-ready
  results omit it, even if a history request was rate limited. The desktop
  source-health row projects only status/completeness, not underlying reasons.
- `slackGet` discards response headers, including `Retry-After`, and has no
  diagnostic logging. `digestCache` is a module-local Map of promises with a
  30-second expiry, not a persisted request/error history. Its expiry starts
  before the request settles, permitting another refresh if a slow fetch exceeds
  30 seconds. No debugger was attached to the live process.

At approximately 19:03Z, the two production application logs were 2,470,124 and
1,989,764 bytes. Read-only scans found zero occurrences of `ratelimited`, either
conversation method name, Slack history-unavailable/rate-limit text, or Slack
Incomplete text. Both continuity error logs were empty. Zero matches establish
missing diagnostics, **not zero failures**. The local Slack state files contain
publisher delivery/incident/watcher state, not the consumer's history/reply
responses. No raw message or personal data is included here.

An isolated four-case reproduction, with every fetch mocked, demonstrated that
history failure, replies rate limit, history missing cursor and replies missing
cursor all return `status:ready`, `complete:false`, no `detail`. The 2–3 requests
per case were in-memory synthetic calls; none reached Slack. This explains why
the current warning cannot identify which occurred or how often.

## Proposed next change

Observe the existing reads without increasing their cadence or channel scope.
Record aggregate counters for refresh attempts, complete/partial refreshes,
history/replies failures by bounded error category, missing cursors, and skipped
cooldown calls. Keep only method, reason, time and duration—no token, message,
user, channel name or thread contents. Persist one bounded summary at most every
five minutes and retain seven days. Preserve per-refresh reason counts in the
cached digest so the source-health detail can distinguish missing coverage.

Honor 429/`ratelimited` `Retry-After` per method and bot workspace, with a bounded
fallback cooldown, no immediate retry, and incomplete coverage during skipped
reads. Retain an in-flight promise until settlement, then start the normal TTL.
Tests should assert calls decrease during cooldown, all three incomplete paths
remain visible, and successful channels' messages remain usable.

Only after normal-read evidence identifies repeated unchanged-thread reads,
consider caching replies keyed by channel/thread and `latest_reply`, reply_count
and root edit timestamp. `latest_reply` alone misses edited/deleted replies;
bounded revalidation and deletion semantics need design. This is not a safe
blind one-line optimization, and no such cache was shipped.

Acceptance: collect naturally occurring traffic for a representative operating
day; report observed causes and denominator (partial refreshes / total refreshes)
with coverage and restart gaps. Never label the unobserved historical rate as
zero. No new Slack API volume is needed or authorized for this measurement.
