# Ask OpsBot

Ask OpsBot is the read-only GPT-6 Luna assistant inside OpsCenter's global
search panel. Managers can type a question and deliberately select **Ask
OpsBot**. Ordinary typing, source search, and Second Brain answers do not make a
paid request.

## Evidence boundary

Ask OpsBot can read bounded schedule facts, per-truck advisor summaries,
OpsCenter search matches, and source-health status. It cannot write records,
dispatch trucks, contact customers, browse the web, upload files, or continue a
stored OpenAI conversation. Every question starts a stateless Responses API
tool loop with `store: false`. Customer names, addresses, phone numbers,
payments, credentials, and hidden prompts are excluded from tool output.

The answer names the OpsCenter sources it used. Source links reopen the relevant
OpsCenter record. Stale, missing, historical, and inferred evidence must remain
explicit in the answer.

## Access and limits

Only authenticated manager and administrator roles can view or call the route.
The server checks same-origin requests, the separate spending approval, the
OpenAI credential, and a private durable ledger before reserving a question.

The pilot is limited to 50 total questions shared by all managers. A question
reserves $0.20 before contacting OpenAI, so the 50 slots also enforce the
approved $10 maximum. Provider errors and uncertain requests stay counted. If
the ledger, approval, or usage record is missing, invalid, exhausted, or paused,
Ask OpsBot fails closed while deterministic OpsCenter search remains available.

See [Spending controls](spending-controls.md) for the exact approval shape and
deployment boundary.
