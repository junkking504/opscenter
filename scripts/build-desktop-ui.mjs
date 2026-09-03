import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const directory = fileURLToPath(new URL('../desktop-ui/', import.meta.url));
function run(command, args) {
  const result = spawnSync(command, args, { cwd: directory, stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status || 1);
}
// The copied prototype lockfile is its dependency authority. Do not resolve
// these components through OpsCenter's older Tailwind/UI dependency tree.
if (!existsSync(`${directory}/node_modules/vite/bin/vite.js`)) {
  run('npm', ['ci', '--no-audit', '--no-fund']);
}
run(process.execPath, ['node_modules/typescript/bin/tsc', '--noEmit']);
run(process.execPath, ['node_modules/vite/bin/vite.js', 'build', '--config', 'vite.opscenter.config.ts']);
