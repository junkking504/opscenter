
export type DumpFeePolicy = {
  effectiveFrom: string;
  defaultMinimumFee?: number;
  facilities: Array<{ name: string; aliases: string[]; minimumFee: number }>;
};
const normalized = (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const validFee = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 0 && Number.isSafeInteger(Math.round(value * 100)) && Math.abs(value * 100 - Math.round(value * 100)) < 0.0001;

export function parseDumpFeePolicy(value: unknown): DumpFeePolicy | null {
  const policy = value as DumpFeePolicy | null;
  if (!policy || !/^\d{4}-\d{2}-\d{2}$/.test(policy.effectiveFrom) || !Array.isArray(policy.facilities)
    || (policy.defaultMinimumFee !== undefined && !validFee(policy.defaultMinimumFee))) return null;
  const names = new Set<string>();
  for (const facility of policy.facilities) {
    if (!facility || typeof facility.name !== 'string' || !Array.isArray(facility.aliases) || !validFee(facility.minimumFee)) return null;
    for (const alias of [facility.name, ...facility.aliases]) {
      if (typeof alias !== 'string' || !normalized(alias) || names.has(normalized(alias))) return null;
      names.add(normalized(alias));
    }
  }
  return policy;
}
