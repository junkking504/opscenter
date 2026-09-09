import { refreshQboFinancialStatements } from "../lib/qbo-financial-refresh";
const argument = (name: string) => { const i = process.argv.indexOf(name); return i < 0 ? "" : process.argv[i + 1] || ""; };
// Explicit read-only collection; verify Intuit Builder/no-charge access first.
refreshQboFinancialStatements(argument("--through"), argument("--company"))
  .then(result => console.log(JSON.stringify(result)))
  .catch(error => { console.error(error instanceof Error ? error.message : "QBO report collection failed."); process.exitCode = 1; });
