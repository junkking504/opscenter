// Publish a deliberately reviewed public-source snapshot. This command never fetches external data.
import fs from 'node:fs';
import path from 'node:path';
import { specOpsConditions } from '../desktop-ui/lib/specops-conditions';
import { specOpsConditionsFile } from '../lib/specops-conditions';
const input = process.argv[2];
if (!input) throw new Error('Provide the reviewed snapshot JSON file.');
if (fs.statSync(input).size > 32000) throw new Error('Snapshot exceeds size limit.');
const raw = JSON.parse(fs.readFileSync(input, 'utf8'));
const value = specOpsConditions(raw);
if (raw.schema !== 1 || (!value.outage && !value.storm) || (raw.outage && !value.outage) || (raw.storm && !value.storm)) throw new Error('Invalid or inconsistent observation; nothing published.');
const file = specOpsConditionsFile();
if (fs.existsSync(file)) {
  const previous = specOpsConditions(JSON.parse(fs.readFileSync(file, 'utf8')));
  if (previous.storm && value.storm && previous.storm.name === value.storm.name && Date.parse(value.storm.observedAt) < Date.parse(previous.storm.observedAt)) throw new Error('Refusing to roll back the NHC observation time.');
  for (const key of ['outage', 'storm'] as const) {
    if (previous[key] && (!value[key] || Date.parse(value[key]!.checkedAt) < Date.parse(previous[key]!.checkedAt))) throw new Error('Refusing to remove or replace a newer observation.');
  }
}
fs.mkdirSync(path.dirname(file), { recursive: true });
const temporary = file + '.' + process.pid + '.tmp';
fs.writeFileSync(temporary, JSON.stringify(value, null, 2) + '\n', { mode: 0o600, flag: 'wx' });
fs.renameSync(temporary, file);
console.log('Published validated SpecOps observations.');
