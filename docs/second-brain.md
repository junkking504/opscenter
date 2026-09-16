# Second Brain

Second Brain is OpsCenter's searchable operational knowledge library. Open it
from the top bar in any desktop workspace. The initial scope is procedures,
decisions and resolved incidents. Opening the library starts with the current
workspace plus general guidance; operators can select all workspaces and search
titles, summaries, steps, sources and owners. Existing workspace names and keys
remain unchanged. `knowledge=<entry-id>` deep links open the relevant entry.

## Knowledge and source authority

Six starter guides are curated from the canonical documents. Each includes a
source excerpt, a pinned source revision and the documentation review date.
They are labeled **Documented**, not verified observations of current business
records. Their source files remain canonical; revise the guide and its source
reference together when a procedure changes. Guides can be copied into a new
draft, but cannot be overwritten through the UI.

Manager-created notes start as **Needs review**. A manager or administrator must
check the source and supply verification evidence before marking one verified.
The server records the reviewer and time and schedules review 30 days later.
Expired reviews display **Review due**. Editing or restoring an entry clears its
verification and returns it to review. Archiving is recoverable. No entry can
change appointments, payroll, payments, source freshness or external records.

## Permissions and persistence

Authenticated operators can read curated guides. Captured notes and their
history are readable and writable only by managers and administrators, using
the existing `sensitive.write` role boundary. Notes are shared within that
audience. No crew portal exposure is added. Avoid credentials and unnecessary
personal information in notes or source links.

`GET/POST /api/desktop/knowledge` uses authenticated sessions, private/no-store
responses, bounded request bodies and the existing trusted-origin check. The
registered Class 1 actions in `lib/knowledge-store.ts` are save, verify, archive
and restore. Each requires a request ID and expected entry revision; the actor
comes from the session, not the request. There are no external writers, AI
requests, subscriptions or background polling.

Runtime records live in `data/second-brain/<UUID>/<revision>.json`. The normal
immutable release's `data` symlink keeps these in the external OpsBot data
directory. An isolated test/preview can use `OPSCENTER_KNOWLEDGE_DIR`; never point
a test at the production directory. No runtime entry belongs in Git, a release
snapshot, or a Business bundle.

Each revision contains a complete entry, action history, actor, request ID and
request fingerprint. A fully written and fsynced temporary file is published by
an atomic exclusive hard link. Competing saves cannot overwrite a revision.
Replaying the same actor/request/content returns its saved result; reuse with
different content and stale versions fail. A failed or uncertain response keeps
the draft and request identity in the UI for read-back or idempotent retry.
Unreadable history produces an explicit unavailable state and blocks saves;
it is never silently replaced with an empty store.

## Recovery and limitations

Back up the entire external `second-brain` directory with its revision files
and private permissions. To restore, pause knowledge editing, recover the
complete directory from the approved backup and validate the revision sequence
before reopening it. Never delete a damaged revision to make a read pass or
replay external business actions. The regression test round-trips a backup
through an isolated directory and checks complete read-back.

This first version uses local text search and deliberate capture. It does not
automatically collect chats, ingest customer records, generate AI answers, or
infer that an incident is resolved. Reviewer verification is a recorded human
attestation, not an automatic source-system query. Review dates are shown when
the library is opened; no reminder service is enabled.

Validation: `npm run verify:knowledge`, targeted lint, both TypeScript projects,
the full build, and authenticated browser checks of search, source detail,
capture, verification, revision reset, archival and restoration.
