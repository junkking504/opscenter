/** Keep block thickness stable as routing, selection and viewport space change. */
export function scheduleViewportLayout(natural: number[], labels: number[], available: number) {
  const heights = natural.map((height, index) => Math.ceil(Math.max(labels[index] || 20, height)));
  return { scale: 1, heights, fits: heights.reduce((sum, height) => sum + height, 0) <= available };
}
