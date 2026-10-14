# Command and Crew RPH

Command's RPH card and Crew → Today share `desktop-ui/lib/crew-rph.ts`.
The calculation retains the desktop Crew formula: total credited revenue divided
by total valid worked labor hours. It is not the mean of individual rates and
does not divide company revenue by payroll dollars. Individual cards divide the
employee's credited revenue by that employee's worked hours.

The selected-day `readDesktopKrewe` adapter supplies the same recorded clock-ins,
corrected hours, and verified JunkWare shift values used by Crew. A row without
a valid clock-in timestamp or positive finite worked hours is excluded from both
the numerator and denominator. No hours are invented for roster-only, job-only,
or salaried rows. Missing revenue for a valid worked shift, missing day coverage,
or no eligible hours makes the aggregate unavailable. A recorded zero revenue
with valid hours remains a supported zero. Calculation precision is retained;
currency is formatted only for display.

Command uses the existing revenue/payroll source freshness contract and re-ages
retained values in the browser. Unsupported or stale inputs receive a warning
state, never a healthy zero. Clicking RPH opens Crew for the same selected date.
The card's full meter indicates available input, not achievement of a new target.
Employee RPH appears in both default pay cards and production cards. The pay-period employee card, weekly totals, and daily source details recompute the same ratio from eligible days in the displayed range, using unrounded daily inputs rather than rounded period-hour totals.

No payroll writer, collector, external provider, source record, or deployment
is changed. Validation: `node --import tsx scripts/test-command-rph.ts`,
both TypeScript projects, desktop build, and local synthetic browser checks.

Local browser fixture: start Vite with `node desktop-ui/node_modules/vite/bin/vite.js --config desktop-ui/vite.opscenter.config.ts --host 127.0.0.1 --port 3197 --strictPort`, then run `node scripts/test-rph-browser.mjs`. Set `RPH_PREVIEW_URL` or `RPH_SCREENSHOT_DIR` to override the local fixture URL or screenshot destination. All fixture application requests are intercepted; write requests fail. Stop the task-owned server afterward.
