import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

// This checker is also installed outside release snapshots. A branch cannot
// approve a new service merely by editing its own copy of the allowlist.
export function spendingViolations(root, manifest) {
  const failures = [];
  for (const [relative, expected] of Object.entries(manifest.protectedFiles || {})) {
    const file = path.join(root, relative);
    if (!fs.existsSync(file) || createHash('sha256').update(fs.readFileSync(file)).digest('hex') !== expected) {
      failures.push(`${relative}: spending control changed; separate review and installed-policy update required`);
    }
  }
  const excluded = new Set(['verify-spending-boundary.mjs', 'test-spending-boundary.mjs', 'test-no-google-map-billing.mjs']);
  const metered = /(?:maps|routes|roads|tile|places)\.googleapis\.com|api\.(?:anthropic|openai|mapbox|twilio|replicate|cohere)\.com|generativelanguage\.googleapis\.com|@googlemaps\//;
  function scan(directory) {
    if (!fs.existsSync(directory)) return;
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      if (['node_modules', '.next', '.git', 'tests', '__tests__', 'fixtures'].includes(entry.name)) continue;
      const full = path.join(directory, entry.name), relative = path.relative(root, full);
      if (entry.isDirectory()) { scan(full); continue; }
      if (!/\.(?:ts|tsx|js|mjs|cjs|py|sh)$/.test(entry.name) || /^test[-.]/.test(entry.name) || excluded.has(entry.name)) continue;
      const source = fs.readFileSync(full, 'utf8');
      if (metered.test(source) && !['lib/maintenance-diagnosis.ts', 'lib/address-research-provider.ts', 'lib/ask-opsbot-agent.ts'].includes(relative)) failures.push(`${relative}: unapproved metered provider`);
      for (const match of source.matchAll(/https?:\/\/([a-zA-Z0-9.-]+)/g)) {
        if (!manifest.hosts.includes(match[1])) failures.push(`${relative}: new external host ${match[1]} needs spending review`);
      }
    }
  }
  for (const dir of ['app', 'lib', 'components', 'desktop-ui', 'scripts', 'deploy']) scan(path.join(root, dir));
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  for (const dependency of Object.keys(pkg.dependencies || {})) {
    if (!manifest.dependencies.includes(dependency)) failures.push(`New runtime dependency ${dependency} needs spending review`);
  }
  const diagnosis = fs.readFileSync(path.join(root, 'lib/maintenance-diagnosis.ts'), 'utf8');
  for (const required of ['maintenanceSpendingApproved', 'validateMaintenanceRequest(body)', 'reserveMaintenanceCall(state, now)', "service_tier: 'default'"]) {
    if (!diagnosis.includes(required)) failures.push(`Maintenance spending control missing: ${required}`);
  }
  const photo = fs.readFileSync(path.join(root, 'lib/truck-load-photo-analysis.ts'), 'utf8');
  const research = fs.readFileSync(path.join(root, 'lib/address-research-provider.ts'), 'utf8');
  const opsBot = fs.readFileSync(path.join(root, 'lib/ask-opsbot-agent.ts'), 'utf8');
  const opsBotRoute = fs.readFileSync(path.join(root, 'app/api/desktop/ask-opsbot/route.ts'), 'utf8');
  for (const required of ['validateAddressResearchRequest(body)', "service_tier: 'default'", 'max_tool_calls: 1']) {
    if (!research.includes(required)) failures.push(`Address research spending control missing: ${required}`);
  }
  if (!photo.includes('throw new Error(METERED_USAGE_BLOCKED)')) failures.push('Unapproved photo analysis must remain blocked');
  for (const required of ['validateAskOpsBotRequest(body)', "service_tier: 'default'", 'store: false', "tool_choice: call === 0 ? 'required' : 'auto'", 'parallel_tool_calls: false']) {
    if (!opsBot.includes(required)) failures.push(`Ask OpsBot spending control missing: ${required}`);
  }
  for (const required of ["opsRoleCan(session.role, 'sensitive.write')", 'askOpsBotApproved()', 'reserveAskOpsBotQuestion(actorHash)', 'settleAskOpsBotQuestion(reservation, result.usage)', 'settleAskOpsBotQuestion(reservation, null)']) {
    if (!opsBotRoute.includes(required)) failures.push(`Ask OpsBot route control missing: ${required}`);
  }
  return [...new Set(failures)];
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = path.resolve(process.argv[2] || '.');
  const manifest = JSON.parse(fs.readFileSync(new URL('./approved-service-hosts.json', import.meta.url), 'utf8'));
  const failures = spendingViolations(root, manifest);
  if (failures.length) { console.error(failures.join('\n')); process.exitCode = 1; }
  else console.log('Spending boundary passed: known service hosts, reviewed dependencies, and approved metered call sites only.');
}
