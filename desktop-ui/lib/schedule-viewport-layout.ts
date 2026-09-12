/** Fit appointment lanes without scaling the truck names or load labels. */
export function scheduleViewportLayout(natural: number[], labels: number[], available: number) {
  const heights = (scale: number) => natural.map((height, index) => Math.ceil(Math.max(labels[index] || 36, height * scale)));
  const total = (scale: number) => heights(scale).reduce((sum, height) => sum + height, 0);
  let low = .65, high = 1;
  if (total(high) <= available) low = high;
  else if (total(low) <= available) {
    for (let step = 0; step < 20; step++) {
      const mid = (low + high) / 2;
      if (total(mid) <= available) low = mid; else high = mid;
    }
  }
  return { scale: low, heights: heights(low), fits: total(low) <= available };
}
