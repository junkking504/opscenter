const ordinalWords = ['FIRST','SECOND','THIRD','FOURTH','FIFTH','SIXTH','SEVENTH','EIGHTH','NINTH','TENTH','ELEVENTH','TWELFTH','THIRTEENTH','FOURTEENTH','FIFTEENTH','SIXTEENTH','SEVENTEENTH','EIGHTEENTH','NINETEENTH'];
const tensWords = ['TWENTY','THIRTY','FORTY','FIFTY','SIXTY','SEVENTY','EIGHTY','NINETY'];
const units = ['ONE','TWO','THREE','FOUR','FIVE','SIX','SEVEN','EIGHT','NINE'];
const shortOrdinals = new Map(ordinalWords.map((word, index) => [word, index + 1]));
tensWords.forEach((word, index) => {
  const n = (index + 2) * 10;
  shortOrdinals.set(word.replace(/Y$/, 'IETH'), n);
  ordinalWords.slice(0, 9).forEach((unit, index) => shortOrdinals.set(`${word} ${unit}`, n + index + 1));
});
function writtenOrdinal(words: string): number | null {
  const short = shortOrdinals.get(words);
  if (short) return short;
  // A bounded grammar, not fuzzy spelling: ONE HUNDRED [AND] FIRST,
  // TWO THOUSANDTH, etc. Unknown/extra words remain a literal road name.
  for (const [scale, value] of [['THOUSAND', 1000], ['HUNDRED', 100]] as const) {
    const match = words.match(new RegExp(`^(${units.join('|')}) ${scale}(TH|(?: (?:AND )?(.+))?)$`));
    if (!match) continue;
    const high = (units.indexOf(match[1]) + 1) * value;
    if (match[2] === 'TH') return high;
    if (!match[3]) return null;
    const low = writtenOrdinal(match[3]);
    return low && low < value ? high + low : null;
  }
  return null;
}
const numericOrdinal = (n: number) => `${n}${n % 100 >= 11 && n % 100 <= 13 ? 'TH' : ({1:'ST',2:'ND',3:'RD'} as Record<number,string>)[n % 10] || 'TH'}`;
export function normalizeStreetOrdinal(text: string): string {
  return text.replace(/\b(\d+[A-Z]{0,3} (?:N |S |E |W |NE |NW |SE |SW )?)([A-Z]+(?: [A-Z]+){0,8})(?= (?:ST|RD|AVE|DR|LN|CT|BLVD|HWY|PL|PKWY|TER|CIR|TRL|WAY)\b)/g,
    (original, house: string, words: string) => {
      const value = writtenOrdinal(words);
      return value ? house + numericOrdinal(value) : original;
    });
}
