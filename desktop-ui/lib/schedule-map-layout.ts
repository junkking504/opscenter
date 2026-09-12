export const territoryMapCenters: Record<string, [number, number]> = {
  NO: [29.95, -90.08], JP: [29.95, -90.18], NS: [30.45, -90.04],
  RP: [30.02, -90.45], BR: [30.45, -91.15], LF: [30.22, -92.02],
};

export function locatorSize(zoom: number) {
  return Math.max(10, Math.min(36, 10 + (zoom - 10) * 4));
}

export function truckLocatorSize(zoom: number) {
  return Math.max(22, Math.min(28, 22 + (zoom - 10)));
}
