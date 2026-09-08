// Screen distances are used only to offer an overlap chooser. Never move pins.
export type MapPinPoint = { id: string; x: number; y: number };
export const territoryMapCenters: Record<string, [number, number]> = {
  NO: [29.95, -90.08], JP: [29.95, -90.18], NS: [30.45, -90.04],
  BR: [30.45, -91.15], LF: [30.22, -92.02],
};
export function nearbyMapPins(points: MapPinPoint[], id: string, hitRadius = 30): MapPinPoint[] {
  const target = points.find(point => point.id === id);
  if (!target) return [];
  return points.filter(point => Math.hypot(point.x - target.x, point.y - target.y) <= hitRadius)
    .sort((a, b) => a.id.localeCompare(b.id));
}
