// Geographic anchors stay exact; only overlapping icons receive screen offsets.
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

export function separateMapPins(points: MapPinPoint[], spacing = 44) {
  const placed: Array<MapPinPoint & { dx: number; dy: number }> = [];
  for (const point of [...points].sort((a, b) => a.id.localeCompare(b.id))) {
    let dx = 0, dy = 0;
    const free = () => placed.every(other => Math.hypot(point.x + dx - other.x - other.dx, point.y + dy - other.y - other.dy) >= spacing);
    // Increasing rings guarantee room even for many trucks parked together.
    for (let ring = 1; !free(); ring++) {
      const count = ring * 8;
      for (let step = 0; step < count; step++) {
        const angle = step * Math.PI * 2 / count;
        dx = Math.cos(angle) * spacing * ring;
        dy = Math.sin(angle) * spacing * ring;
        if (free()) break;
      }
    }
    placed.push({ ...point, dx, dy });
  }
  return placed;
}
