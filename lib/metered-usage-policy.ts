import fs from 'node:fs';
import path from 'node:path';

// Credentials authenticate; they never authorize spending. No env flag can
// grant approval, select a more expensive model, or expand the approved scope.
export const MAINTENANCE_APPROVAL = 'maintenance-pilot-20260908';
export const APPROVED_MODEL = 'gpt-5.6-luna';
export const APPROVED_MONTHLY_MICROS = 10_000_000;
export const METERED_USAGE_BLOCKED = 'Metered usage is blocked: explicit spending approval is required.';
export const spendingPolicyPath = () => path.join(process.env.HOME || '', 'Library/Application Support/OpsCenter/spending-policy.json');

export function maintenanceSpendingApproved(readPolicy = () => fs.readFileSync(spendingPolicyPath(), 'utf8')): boolean {
  try {
    const policy = JSON.parse(readPolicy());
    const approval = policy.approvals?.['maintenance-diagnosis'];
    return policy.version === 1 && policy.default === 'deny' && policy.paused === false
      && approval?.id === MAINTENANCE_APPROVAL && approval.enabled === true
      && approval.provider === 'openai' && approval.model === APPROVED_MODEL
      && approval.monthlyBudgetMicros === APPROVED_MONTHLY_MICROS;
  } catch { return false; }
}

export function assertMeteredFeatureApproved(feature: string): void {
  if (feature !== 'maintenance-diagnosis' || !maintenanceSpendingApproved()) throw new Error(METERED_USAGE_BLOCKED);
}

// Only this fixed request shape is approved. Images, tools, sessions, priority
// tiers, arbitrary models and request continuations cannot inherit approval.
export function validateMaintenanceRequest(body: Record<string, unknown>): void {
  const fields = ['model', 'store', 'instructions', 'input', 'max_output_tokens', 'text', 'service_tier'];
  if (Object.keys(body).some(key => !fields.includes(key)) || body.model !== APPROVED_MODEL
    || body.store !== false || body.service_tier !== 'default' || body.max_output_tokens !== 2048
    || typeof body.instructions !== 'string' || typeof body.input !== 'string'
    || Buffer.byteLength(JSON.stringify(body)) > 20_000) throw new Error(METERED_USAGE_BLOCKED);
}
