// Inputs are already normalized for punctuation, case and street abbreviations.
// Limit correction to one long alphabetic name token. Numbers, road types and
// directions must remain exact, even when they differ by only one character.
const protectedTokens = new Set(['ST','RD','AVE','DR','LN','CT','BLVD','HWY','PL','PKWY','TER','CIR','TRL','N','S','E','W','NE','NW','SE','SW','NORTH','SOUTH','EAST','WEST','SAINT']);

function minorTypo(left: string, right: string): boolean {
  if (!/^[A-Z]{6,}$/.test(left) || !/^[A-Z]{6,}$/.test(right)) return false;
  if (protectedTokens.has(left) || protectedTokens.has(right)) return false;
  if (Math.abs(left.length - right.length) === 1) {
    const [longer, shorter] = left.length > right.length ? [left, right] : [right, left];
    let index = 0;
    while (index < shorter.length && longer[index] === shorter[index]) index++;
    return longer.slice(index + 1) === shorter.slice(index);
  }
  if (left.length !== right.length) return false;
  const differences = [...left].flatMap((letter, index) => letter === right[index] ? [] : [index]);
  return differences.length === 2 && differences[1] === differences[0] + 1
    && left[differences[0]] === right[differences[1]] && left[differences[1]] === right[differences[0]];
}

export function hasMinorStreetCorrection(requested: string, house: string, street: string, city: string, zip: string): boolean {
  if (!city || !zip) return false;
  const withoutUnit = requested.replace(/\b(?:SUITE|STE|UNIT|APT|APARTMENT|FLOOR|FL)\s+[A-Z0-9]+\b/g, '').replace(/\s+/g, ' ').trim();
  const endings = [` ${city} LA ${zip}`, ` ${city} LOUISIANA ${zip}`, ` ${city} ${zip}`];
  const ending = endings.find(value => withoutUnit.endsWith(value));
  if (!ending) return false;
  const input = withoutUnit.slice(0, -ending.length).split(' ');
  const expected = `${house} ${street}`.split(' ');
  if (input.length !== expected.length || input[0] !== expected[0]) return false;
  const differences = input.flatMap((token, index) => token === expected[index] ? [] : [index]);
  return differences.length === 1 && differences[0] > 0
    && minorTypo(input[differences[0]], expected[differences[0]]);
}
