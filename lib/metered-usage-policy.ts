import fs from 'node:fs';
import path from 'node:path';

// Credentials authenticate; they never authorize spending. No env flag can
// grant approval, select a more expensive model, or expand the approved scope.
export const MAINTENANCE_APPROVAL = 'maintenance-pilot-20260908';
export const APPROVED_MODEL = 'gpt-5.6-luna';
export const APPROVED_MONTHLY_MICROS = 10_000_000;
export const ADDRESS_RESEARCH_APPROVAL = 'address-investigation-20260913';
export const ADDRESS_RESEARCH_LIMIT_MICROS = 100_000;
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

export function addressResearchApproved(readPolicy = () => fs.readFileSync(spendingPolicyPath(), 'utf8')): boolean {
  try {
    const policy = JSON.parse(readPolicy());
    const a = policy.approvals?.['address-investigation'];
    return policy.version === 1 && policy.default === 'deny' && policy.paused === false
      && a?.id === ADDRESS_RESEARCH_APPROVAL && a.enabled === true && a.provider === 'openai'
      && a.model === APPROVED_MODEL && a.monthlyBudgetMicros === APPROVED_MONTHLY_MICROS
      && a.sharedBudget === 'maintenance-diagnosis' && a.perAddressBudgetMicros === ADDRESS_RESEARCH_LIMIT_MICROS
      && a.maxAttemptsPerAddress === 1 && a.maxSearchCalls === 1 && a.maxOutputTokens === 2048;
  } catch { return false; }
}

export function validateAddressResearchRequest(body: Record<string, unknown>): void {
  const fields = ['model','store','service_tier','instructions','input','max_output_tokens','max_tool_calls','tools','tool_choice','include','text','reasoning'];
  const tool = [{ type: 'web_search', search_context_size: 'low', return_token_budget: 'default' }];
  if (Object.keys(body).some(k => !fields.includes(k)) || body.model !== APPROVED_MODEL || body.store !== false
    || body.service_tier !== 'default' || body.max_output_tokens !== 2048 || body.max_tool_calls !== 1
    || body.tool_choice !== 'required' || JSON.stringify(body.tools) !== JSON.stringify(tool)
    || JSON.stringify(body.include) !== JSON.stringify(['web_search_call.action.sources'])
    || JSON.stringify(body.reasoning) !== JSON.stringify({ effort: 'low' })
    || typeof body.input !== 'string' || typeof body.instructions !== 'string'
    || Buffer.byteLength(JSON.stringify(body)) > 10_000) throw new Error(METERED_USAGE_BLOCKED);
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
