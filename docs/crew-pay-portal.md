# Crew My Pay portal

Crew members sign in at `https://crew.junk-king.app` with the username already assigned to them in JunkWare. A shared temporary password is used only for the first sign-in. OpsCenter then requires the employee to create a personal password before `/my-pay` can load. The resulting signed Crew session lasts up to 30 days.

The crew hostname exposes only the crew portal, legal pages, and support. Requests for management routes are redirected to crew login. `ops.junk-king.app` remains the management hostname.

## Authentication configuration

If `crew.junk-king.app` remains behind a Cloudflare Access application, its Crew policy must bypass identity-provider verification. OpsCenter performs the Crew authentication itself; an email one-time PIN must not appear before the username/password page.

Bind a dedicated Worker KV namespace as `CREW_CREDENTIALS`. Store these values as protected production/Worker secrets:

```text
OPS_CREW_ROSTER_JSON=[{"employee":"Example Employee","username":"junkware.username","active":true}]
OPS_CREW_TEMP_PASSWORD_HASH=<one-way hash of the shared temporary password>
OPS_CREW_SESSION_SECRET=<at least 32 characters of cryptographic random data>
```

Employee names must identify the same employee represented in `daily_metrics` payroll records, and usernames must match JunkWare exactly (comparison is case-insensitive). The roster is private payroll-access configuration; do not put the real roster, temporary password, hashes, or session secret in source control or client-side code. Removing or deactivating an employee in the roster invalidates that employee's existing Crew session as well as future logins.

The shared temporary password is accepted only while that username has no personal credential in `CREW_CREDENTIALS`. Completing password setup stores a salted, server-peppered one-way hash and permanently disables the temporary password for that username. Personal passwords must be 10–128 characters and contain at least one letter and one number.

## Crew performance views

The signed-in crew portal includes daily metrics for crew members with a recorded clock-in that day and a month-to-date crew leaderboard. Both share only jobs completed, revenue, average job size, and tips. Total pay, hourly rates, hours, bonus amounts, bonus-day counts, and other payroll details remain visible only to the signed-in employee in their private pay sections.

Dispatch can add a **Crew Note** to an appointment in OpsCenter Jobs. The note is stored in the protected runtime data directory and appears in the signed-in employee's daily portal only when that employee is assigned to that appointment through the authoritative driver, navigator, crew, or additional-crew fields. Notes are not written back to JunkWare and must not be used as a substitute for franchise or call-center notes.

Each employee also has a personal performance summary with Day, Week, and Month views. Week means Monday through the current day, and Month means calendar month-to-date. Longer-range average job size and estimate close percentage are recalculated from the combined underlying jobs and estimates rather than averaged from daily percentages.

## Pay-period schedule

The portal uses two-week pay periods, with Week 1 and Week 2 each running Monday through Sunday. The schedule is anchored to Monday `2026-08-03`, matching the current OpsCenter crew-period implementation. If the authoritative schedule uses another pay-period start, set:

```text
OPS_PAY_PERIOD_ANCHOR=YYYY-MM-DD
```

The anchor must be the Monday that starts Week 1 of a pay period. Overtime is calculated independently in each Monday-through-Sunday workweek after 40 hours, at 1.5× the recorded hourly rate.

## Activation sequence

1. Create and bind the dedicated `CREW_CREDENTIALS` KV namespace.
2. Add the JunkWare username-to-employee roster and authentication secrets.
3. Set the Crew Access application to bypass identity-provider verification.
4. Deploy OpsCenter with the `crew.junk-king.app` custom domain.
5. Confirm a wrong password is rejected and the shared temporary password redirects to `/set-password`.
6. Complete a controlled test user's setup and confirm the temporary password no longer works for that username.
