/** Fill spare panel space without shrinking appointments, labels or footers.
 * Busy schedules retain their natural row heights and remain scrollable.
 */
export function scheduleViewportLayout(natural: number[], labels: number[], available: number, footers: number[] = []) {
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
    return { scale: 1, heights, fits: true };
  }
  return { scale: 1, heights: naturalHeights, fits: false };
}
