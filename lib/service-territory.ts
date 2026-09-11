// Dispatch geography is not franchise ownership. Keep this pure/shared so the
// browser, calendar and server-side planner cannot classify the same stop differently.
export const serviceTerritoryLabels: Record<string, string> = {
  NO: 'New Orleans', JP: 'Jefferson Parish', NS: 'Northshore',
  BR: 'Baton Rouge', LF: 'Lafayette', UNK: 'Unclassified',
};
type Area = { code: string; areaCode: string; area: string };
const rules: Array<[string, string, string, string]> = [
  ['greenwell springs', 'BR', 'GWS', 'Greenwell Springs'],
  ['denham springs|walker', 'BR', 'LIV', 'Livingston'],
  ['prairieville|gonzales', 'BR', 'ASC', 'Ascension'],
  ['baton rouge', 'BR', 'BR', 'Baton Rouge'],
  ['lafayette', 'LF', 'LAF', 'Lafayette'],
  ['algiers|avondale|barataria|belle chasse|bridge city|crown point|estelle|gretna|harvey|jean lafitte|lafitte|marrero|terrytown|timberlane|waggaman|westwego|woodmere', 'JP', 'WB', 'Westbank'],
  ['chalmette|new orleans east', 'NO', 'EM', 'East Metro'],
  ['laplace|la place', 'NO', 'RP', 'River Parishes'],
  ['covington', 'NS', 'COV', 'Covington'], ['mandeville', 'NS', 'MAN', 'Mandeville'],
  ['slidell', 'NS', 'SLI', 'Slidell'], ['hammond', 'NS', 'HAM', 'Hammond'],
  ['pearl river', 'NS', 'PR', 'Pearl River'],
  ['metairie', 'JP', 'MET', 'Metairie'], ['kenner', 'JP', 'KEN', 'Kenner'],
  ['harahan', 'JP', 'HAR', 'Harahan'], ['new orleans', 'NO', 'NO', 'New Orleans'],
  ['river ridge|elmwood|jefferson', 'JP', 'EB', 'Eastbank'],
];
// Explicit, reviewed ZIPs only. Do not extrapolate an entire ZIP prefix into a
// territory. Add unfamiliar localities here with regression coverage after review.
const zipAreas: Record<string, Area> = {
  '70739': { code: 'BR', areaCode: 'GWS', area: 'Greenwell Springs' },
  '70508': { code: 'LF', areaCode: 'LAF', area: 'Lafayette' },
  '70121': { code: 'JP', areaCode: 'EB', area: 'Eastbank' },
  '70123': { code: 'JP', areaCode: 'EB', area: 'Eastbank' },
  ...Object.fromEntries(['70037','70053','70056','70058','70072','70094','70114','70131'].map(zip =>
    [zip, { code: 'JP', areaCode: 'WB', area: 'Westbank' }])),
  // Preserve the established East Metro dispatch zone from JobsMap. This is a
  // presentation area, not a precise neighborhood boundary (70126 also spans Gentilly).
  ...Object.fromEntries(['70043','70126','70127','70128','70129'].map(zip =>
    [zip, { code: 'NO', areaCode: 'EM', area: 'East Metro' }])),
};
export function sourceTerritoryCode(value: string) {
  return /westbank|jefferson/i.test(value) ? 'JP' : /north.?shore/i.test(value) ? 'NS'
    : /baton/i.test(value) ? 'BR' : /lafayette/i.test(value) ? 'LF'
      : /new orleans/i.test(value) ? 'NO' : 'UNK';
}
export function serviceTerritory(address: string, sourceTerritory = '') {
  const normalized = address.trim().replace(/\s+/g, ' ');
  const zip = normalized.match(/(?:^|[\s,])(\d{5})(?:-\d{4})?\s*(?:,?\s*(?:USA|United States))?$/i)?.[1];
  const state = normalized.match(/(?:,\s*|\s)([a-z]{2}|Louisiana)(?:\s+\d{5}(?:-\d{4})?)?\s*(?:,?\s*(?:USA|United States))?$/i)?.[1];
  // Some source addresses use "street city, LA ZIP", others "street, city, ZIP".
  // The terminal-locality expression supports both without searching street text.
  const locality = normalized;
  // Match a terminal locality, never a city name embedded in a street, note, or
  // building name. Comma-free addresses must still supply a postal/state suffix.
  const rule = rules.find(([cities]) => new RegExp(`(?:^|[ ,])(?:${cities})\\s*,?\\s*(?:(?:[A-Z]{2}|Louisiana)\\s*,?\\s*)?(?:\\d{5}(?:-\\d{4})?)?\\s*(?:,?\\s*(?:USA|United States))?$`, 'i').test(locality)
    && (normalized.includes(',') || Boolean(zip) || new RegExp(`^(?:${cities})$`, 'i').test(normalized)));
  const cityArea = rule ? { code: rule[1], areaCode: rule[2], area: rule[3] } : null;
  const zipArea = zip ? zipAreas[zip] : null;
  const outsideState = Boolean(state && !/^(?:la|louisiana)$/i.test(state));
  const conflict = Boolean(cityArea && zipArea && cityArea.code !== zipArea.code
    // New Orleans postal city includes Algiers: the established Westbank ZIPs
    // intentionally refine this postal-city alias into JP/WB for dispatch.
    && !(cityArea.code === 'NO' && cityArea.areaCode === 'NO' && zipArea.code === 'JP'));
  const postalCityRefinement = cityArea?.areaCode === 'NO' && zipArea?.areaCode === 'EM';
  const area = outsideState || conflict ? null : postalCityRefinement ? zipArea : cityArea && zipArea?.code === cityArea.code ? cityArea : zipArea || cityArea;
  const sourceCode = sourceTerritoryCode(sourceTerritory);
  const mismatch = Boolean(area && sourceCode !== 'UNK' && sourceCode !== area.code);
  return {
    ...(area || { code: 'UNK', areaCode: 'UNK', area: 'Location Needs Review' }),
    label: serviceTerritoryLabels[area?.code || 'UNK'], sourceTerritory, mismatch,
    needsReview: !area,
    reason: outsideState ? 'Service address is outside Louisiana.' : conflict ? 'Service city and ZIP disagree.'
      : !area ? 'Service locality is not recognized; franchise is not used as a location fallback.'
        : mismatch ? `Service address places this stop in ${serviceTerritoryLabels[area.code]}; JunkWare franchise remains ${sourceTerritory}.` : '',
  };
}
