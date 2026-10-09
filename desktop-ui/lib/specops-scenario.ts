// The sandbox can exchange numeric planning inputs only, never app records or actions.
const limits: Record<string, readonly [number, number]> = {
  lat: [28.4, 33.2], lon: [-94.3, -83.3], cat: [0, 5], heading: [0, 360], speed: [5, 25], size: [0.7, 1.35],
  rate: [0, 10000000], loadsAldi: [0, 12], loadsSuper: [0, 15], shareAldi: [0, 100], shareWd: [0, 100], shareOther: [0, 100],
  trucks: [0, 40], lpd: [0, 8], dump: [0, 10000000], labor: [0, 10000000], fuel: [0, 10000000], roy: [0, 100], terms: [0, 10000000], window: [0, 10000000],
};
export function specOpsScenario(value: unknown): Record<string, number> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const result: Record<string, number> = {};
  for (const [key, [min, max]] of Object.entries(limits)) {
    const number = record[key];
    if (typeof number !== 'number' || !Number.isFinite(number) || number < min || number > max) return null;
    result[key] = number;
  }
  if (!Number.isInteger(result.cat) || ![0.7, 1, 1.35].includes(result.size)) return null;
  return result;
}
