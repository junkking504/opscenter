/** Fit the overview without shrinking truck labels or the live status footer.
 * Keep at least 75% lane thickness; denser boards retain vertical scrolling.
 */
export function scheduleViewportLayout(natural: number[], labels: number[], available: number, footers: number[] = []) {
  const heightsAt = (scale: number) => natural.map((height, index) => {
    const footer = footers[index] || 0;
    return Math.ceil(Math.max(labels[index] || 20, (height - footer) * scale + footer));
  });
  const fits = (heights: number[]) => heights.reduce((sum, height) => sum + height, 0) <= available;
  if (fits(heightsAt(1))) return { scale: 1, heights: heightsAt(1), fits: true };
  let scale = .75;
  let upper = 1;
  if (fits(heightsAt(scale))) {
    // Include per-row rounding in the fit, so the final row never loses pixels.
    for (let i = 0; i < 24; i++) {
      const candidate = (scale + upper) / 2;
      if (fits(heightsAt(candidate))) scale = candidate;
      else upper = candidate;
    }
  }
  const heights = heightsAt(scale);
  return { scale, heights, fits: fits(heights) };
}
