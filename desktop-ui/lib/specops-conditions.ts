export type OutageObservation = {
  checkedAt: string; sourceAgeMinutes: number; sourceUrl: string;
  customersOut: number; customersTracked: number;
  states: { name: string; customersOut: number }[];
};
export type StormObservation = {
  checkedAt: string; observedAt: string; sourceUrl: string; name: string;
  lat: number; lon: number; windMph: number; heading: number; speedMph: number; pressureMb: number;
};
export type SpecOpsConditions = { schema: 1; outage: OutageObservation | null; storm: StormObservation | null };
const record = (v: unknown): Record<string, unknown> => v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : {};
const number = (v: unknown, min: number, max: number): v is number => typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max;
const count = (v: unknown): v is number => number(v, 0, 500000000) && Number.isInteger(v);
const date = (v: unknown, now: number): v is string => typeof v === 'string' && /^\d{4}-\d\d-\d\dT/.test(v) && Number.isFinite(Date.parse(v)) && Date.parse(v) <= now + 60000;
function source(v: unknown, hostname: string): v is string {
  if (typeof v !== 'string' || v.length > 500) return false;
  try { const url = new URL(v); return url.protocol === 'https:' && url.hostname === hostname && !url.username && !url.password && !url.port; } catch { return false; }
}
export function specOpsConditions(value: unknown, now = Date.now()): SpecOpsConditions {
  const v = record(value), o = record(v.outage), s = record(v.storm);
  const result: SpecOpsConditions = { schema: 1, outage: null, storm: null };
  if (v.schema !== 1) return result;
  const names = ['Alabama', 'Florida', 'Georgia', 'North Carolina', 'South Carolina'];
  const states = Array.isArray(o.states) ? o.states.map(record) : [];
  if (date(o.checkedAt, now) && number(o.sourceAgeMinutes, 0, 1440) && source(o.sourceUrl, 'poweroutage.us') &&
      new URL(o.sourceUrl).pathname === '/area/regions/south%20east' && count(o.customersOut) && count(o.customersTracked) &&
      o.customersOut <= o.customersTracked && states.length === names.length &&
      names.every(name => states.filter(state => state.name === name).length === 1) &&
      states.every(state => count(state.customersOut)) && states.reduce((sum, state) => sum + (state.customersOut as number), 0) === o.customersOut) {
    result.outage = { checkedAt: o.checkedAt, sourceAgeMinutes: o.sourceAgeMinutes, sourceUrl: o.sourceUrl,
      customersOut: o.customersOut, customersTracked: o.customersTracked,
      states: states.map(state => ({ name: state.name as string, customersOut: state.customersOut as number })) };
  }
  if (date(s.checkedAt, now) && date(s.observedAt, now) && Date.parse(s.observedAt) <= Date.parse(s.checkedAt) &&
      source(s.sourceUrl, 'www.nhc.noaa.gov') && typeof s.name === 'string' && /^[A-Za-z -]{1,60}$/.test(s.name) &&
      number(s.lat, -90, 90) && number(s.lon, -180, 180) && number(s.windMph, 0, 250) &&
      number(s.heading, 0, 360) && number(s.speedMph, 0, 100) && number(s.pressureMb, 800, 1100)) {
    result.storm = { checkedAt: s.checkedAt, observedAt: s.observedAt, sourceUrl: s.sourceUrl, name: s.name,
      lat: s.lat, lon: s.lon, windMph: s.windMph, heading: s.heading, speedMph: s.speedMph, pressureMb: s.pressureMb };
  }
  return result;
}
export const outageIsStale = (o: OutageObservation, now = Date.now()) => now - Date.parse(o.checkedAt) + o.sourceAgeMinutes * 60000 >= 30 * 60000;
export const stormIsStale = (s: StormObservation, now = Date.now()) => now - Date.parse(s.observedAt) >= 90 * 60000;
export const stormCategory = (wind: number) => wind >= 157 ? 5 : wind >= 130 ? 4 : wind >= 111 ? 3 : wind >= 96 ? 2 : wind >= 74 ? 1 : 0;
