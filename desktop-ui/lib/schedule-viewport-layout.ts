/** Prefer natural lane sizes after reclaiming the controls above the board.
 * If the complete day still exceeds the viewport, fit it rather than hide rows.
 */
export function scheduleViewportLayout(natural: number[], labels: number[], available: number, footers: number[] = []) {
  if (natural.length && available < natural.length) return {scale:1,chromeScale:1,heights:natural.map((height,i)=>Math.max(height,labels[i]||20)),fits:false};
  const heightsAt = (scale: number) => natural.map((height, index) => {
    const footer = footers[index] || 0;
    return Math.ceil(Math.max(labels[index] || 20, (height - footer) * scale + footer));
  });
  const fits = (heights: number[]) => heights.reduce((sum, height) => sum + height, 0) <= available;
  const naturalHeights = heightsAt(1);
  if (fits(naturalHeights)) {
    // Fill the shared map/schedule panel without stretching appointment text.
    // Distribute whole pixels evenly so the last row reaches the panel bottom.
    const spare = Math.floor(available - naturalHeights.reduce((sum, height) => sum + height, 0));
    const heights = naturalHeights.map((height, index) => height
      + Math.floor(spare / naturalHeights.length)
      + (index < spare % naturalHeights.length ? 1 : 0));
    return { scale: 1, chromeScale: 1, heights, fits: true };
  }
  // Preserve readable truck labels and progress footers while fitting lanes.
  // No arbitrary minimum zoom may send the final appointment below the screen.
  const fitAllChrome = !fits(heightsAt(0));
  const candidate = (scale: number) => fitAllChrome
    ? naturalHeights.map(height => Math.ceil(height * scale))
    : heightsAt(scale);
  let low = 0;
  let high = 1;
  for (let i = 0; i < 40; i++) {
    const mid = (low + high) / 2;
    if (fits(candidate(mid))) low = mid;
    else high = mid;
  }
  const heights = candidate(low);
  return { scale: low, chromeScale: fitAllChrome ? low : 1, heights, fits: fits(heights) };
}
