import fs from 'node:fs';
import path from 'node:path';
import { specOpsConditions } from '../desktop-ui/lib/specops-conditions';
export function specOpsConditionsFile() {
  return path.join(process.env.OPSCENTER_DATA_DIR || process.env.OPSBOT_DATA_DIR || path.join(process.cwd(), 'data'), 'specops', 'conditions.json');
}
export function readSpecOpsConditions(file = specOpsConditionsFile(), now = Date.now()) {
  try {
    if (fs.statSync(file).size > 32000) return specOpsConditions(null, now);
    return specOpsConditions(JSON.parse(fs.readFileSync(file, 'utf8')), now);
  } catch { return specOpsConditions(null, now); }
}
