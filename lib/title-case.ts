const TITLE_BOUNDARY = /(^|[\s/\-–—&(+:[{])([a-z])/g;

/**
 * Capitalize display-heading words without lowercasing acronyms or changing
 * sentence copy. Apostrophes are intentionally not treated as boundaries so
 * labels such as “Today’s Crew” remain natural.
 */
export function titleCaseLabel(value: string): string {
  return value.replace(TITLE_BOUNDARY, (_match, boundary: string, letter: string) => (
    `${boundary}${letter.toUpperCase()}`
  ));
}
