# Crew My Pay portal

Crew members sign in at `https://crew.junk-king.app` with an approved personal email address. Cloudflare Access sends a single-use email code and remembers the verified browser for 30 days. A verified Access identity is then mapped to exactly one employee in OpsCenter before `/my-pay` can read payroll data.

The crew hostname exposes only the crew portal, legal pages, and support. Requests for management routes are redirected to crew login. `ops.junk-king.app` remains the management hostname.

## Cloudflare Access application

Create a self-hosted Access application for `crew.junk-king.app` with:

- Identity provider: One-time PIN
- Allow policy: only the explicit personal email addresses in the active crew roster
- Require login method: One-time PIN
- Application and policy session duration: one month
- HttpOnly application cookie: enabled

Do not use an email-domain wildcard or `Include Everyone`. The Access allowlist and the OpsCenter roster should contain the same email addresses.

OpsCenter validates the signed `Cf-Access-Jwt-Assertion` again before loading pay information. Set these Worker secrets after creating the Access application:

```text
OPS_CREW_ACCESS_TEAM_DOMAIN=https://square-credit-167f.cloudflareaccess.com
OPS_CREW_ACCESS_AUD=<Application Audience AUD tag from the crew Access application>
OPS_CREW_ROSTER_JSON=[{"employee":"Example Employee","email":"employee@example.com","active":true}]
```

Employee names must identify the same employee represented in `daily_metrics` payroll records. The roster is private payroll-access configuration; do not put real employee emails in source control or client-side code. Removing an employee from both the Access policy and the roster revokes future payroll access. Cloudflare can also revoke an active Access session immediately.

## Crew performance views

The signed-in crew portal includes a daily leaderboard for everyone recorded on the crew that day. It shares only jobs completed, average job size, estimate close percentage, tips, and bonuses. Total pay, hourly rates, hours, and other payroll details remain visible only to the signed-in employee in their private pay sections.

Each employee also has a personal performance summary with Day, Week, and Month views. Week means Monday through the current day, and Month means calendar month-to-date. Longer-range average job size and estimate close percentage are recalculated from the combined underlying jobs and estimates rather than averaged from daily percentages.

## Pay-period schedule

The portal uses weekly Monday-through-Sunday pay periods anchored to Monday `2026-07-13`, matching the current OpsCenter crew-period implementation. If the authoritative schedule uses another Monday anchor, set:

```text
OPS_PAY_PERIOD_ANCHOR=YYYY-MM-DD
```

The anchor must be the Monday that starts a pay period. Overtime is calculated after 40 hours in that Monday-through-Sunday period, at 1.5× the recorded hourly rate.

## Activation sequence

1. Add the employee-to-email roster as a Worker secret.
2. Create the Cloudflare Access application and explicit email allow policy.
3. Copy its AUD tag into `OPS_CREW_ACCESS_AUD`.
4. Set the team domain and 30-day Access session duration.
5. Deploy OpsCenter with the `crew.junk-king.app` custom domain.
6. Test with one employee before adding the full roster.
