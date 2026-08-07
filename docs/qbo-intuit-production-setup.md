# OpsCenter QuickBooks Online production setup worksheet

This worksheet is intended to minimize guesswork when creating the Intuit Developer app that will connect QuickBooks Online to OpsCenter.

## Proposed app identity

| Field | Value to enter | Source | Notes |
| --- | --- | --- | --- |
| Developer workspace name | OpsCenter | Codex-derived | Matches the application name and internal dashboard branding. |
| App name | OpsCenter | Codex-derived | Use the same name shown inside OpsCenter. |
| App description | Internal operations and financial reporting dashboard for the user's Junk King businesses | Codex-derived | Do not claim public resale or third-party access. |
| Industry / category | Accounting (recommended) | Codex-derived recommendation | Use the closest available Intuit category for accounting / financial software. If Intuit presents a different list, choose the closest equivalent and note the final choice. |
| Intended users | Internal employees and authorized business owners only | Codex-derived | OpsCenter is not intended for external customer access. |
| Distribution | Private / unlisted internal-use application | Codex-derived | This is an internal tool, not a public consumer app. |
| QuickBooks scope | Accounting only | Codex-derived | Do not enable Payments unless a later requirement explicitly needs it. |
| Intuit sign-in / OpenID | Not required for this setup phase | Codex-derived | Only add if Intuit later requires it. |

## Public URLs

All URLs below are stable HTTPS routes on the current production host.

| Field | Exact value | Source | Notes |
| --- | --- | --- | --- |
| Host domain | `https://ops.junk-king.app` | Codex-derived | Current production hostname from the deployed OpsCenter route. |
| Launch / connect URL | `https://ops.junk-king.app/integrations/qbo` | Codex-derived | Human-facing start page for the connection flow. |
| OAuth redirect URI | `https://ops.junk-king.app/api/integrations/qbo/callback` | Codex-derived | Must match Intuit exactly, including path and trailing slash behavior. |
| Disconnect URL | `https://ops.junk-king.app/integrations/qbo/disconnected` | Codex-derived | Confirmation page after revocation. |
| Privacy Policy URL | `https://ops.junk-king.app/legal/privacy` | Codex-derived | Public page for Intuit review. |
| EULA / Terms URL | `https://ops.junk-king.app/legal/terms` | Codex-derived | Public page for Intuit review. |
| Support URL | `https://ops.junk-king.app/support` | Codex-derived | Public contact page. |

## Environment variables

These variables are used by the server-side QBO scaffold. No real values are stored in the repository.

| Variable | Required now? | Who provides it | Purpose |
| --- | --- | --- | --- |
| `INTUIT_CLIENT_ID` | Yes before production connect | User | Intuit app client ID. |
| `INTUIT_CLIENT_SECRET` | Yes before production connect | User | Intuit app client secret. |
| `INTUIT_REDIRECT_URI` | Yes before production connect | Codex-derived value, copied by user | Must match the redirect URI above exactly. |
| `INTUIT_ENVIRONMENT` | Yes before production connect | User | Usually `production` for the live app; `sandbox` only for testing. |
| `QBO_TOKEN_ENCRYPTION_KEY` | Recommended before storing real tokens | User | Reserved for future token encryption support. |
| `QBO_SUPPORT_EMAIL` | Recommended | User unless already present in deployment config | Support/contact email displayed on the support page and setup pages. |
| `QBO_TOKEN_STORE_DIR` | Optional | User or deployment config | Overrides the default local Mac-hosted token storage directory. |

## Data access explanation

OpsCenter uses QuickBooks Online data only for internal reporting:

- sales and collections reconciliation
- finance summaries
- payroll-support calculations
- historical audit views

The app does not expose the data to third-party customers and is not designed as a resale product.

## Data retention and storage

- Daily QBO artifacts remain on the Mac host that runs OpsCenter.
- The token store is designed to live outside the Git repository.
- Token writes should use atomic replacement and restrictive file permissions.
- The scaffold does not claim encryption is implemented until a real encrypted token store is enabled and tested.

## Revocation / disconnect

The disconnect flow should:

- clear the local token store
- stop future refresh attempts
- preserve historical QBO files already collected for internal reporting

## Security controls currently implemented

- server-side only configuration access
- no token values sent to the client
- OAuth state validation on the callback route
- no secrets logged by the scaffolding routes

## Remaining unanswered questions

| Question | Status |
| --- | --- |
| Legal business name for the Intuit application | User must supply |
| Support email to publish publicly | User must supply unless already configured in the environment |
| Final Intuit category selection | User must confirm |
| Whether the final production token store should use encryption in addition to file permissions | User must confirm for phase 2 |
| Whether the app will need QuickBooks Payments | Not required for this phase |

## User-only checklist

The following actions require the business owner:

1. Sign in to or create an Intuit Developer account.
2. Create the app using the identity and URLs above.
3. Enter the redirect URI exactly as shown.
4. Provide the legal business name if Intuit requests one.
5. Provide a support email if no environment value already exists.
6. Answer any ownership or security review questions from Intuit.
7. Copy the Client ID and Client Secret into a secure environment file on the Mac host.
8. Approve the one-time QBO connection when ready.
