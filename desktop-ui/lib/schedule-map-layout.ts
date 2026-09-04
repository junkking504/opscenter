// Marker offsets are presentation only; leader lines retain the source location.
export type MapPinPoint = { id: string; x: number; y: number };
export const territoryMapCenters: Record<string, [number, number]> = {
  NO: [29.95, -90.08], JP: [29.95, -90.18], NS: [30.45, -90.04],
  BR: [30.45, -91.15], LF: [30.22, -92.02],
};
export function spreadMapPins(points: MapPinPoint[], spacing = 38): MapPinPoint[] {
  const placed: MapPinPoint[] = [];
  // Stable identities keep refreshes from shuffling coincident appointments.
  for (const point of [...points].sort((a, b) => a.id.localeCompare(b.id))) {
    let candidate = { ...point };
    for (let ring = 0; placed.some(other => Math.hypot(other.x - candidate.x, other.y - candidate.y) < spacing); ring++) {
      const radius = (ring + 1) * spacing;
      const count = Math.ceil(2 * Math.PI * radius / spacing);
      let found = false;
      for (let i = 0; i < count; i++) {
        const angle = -Math.PI / 2 + i * 2 * Math.PI / count;
        candidate = { ...point, x: point.x + radius * Math.cos(angle), y: point.y + radius * Math.sin(angle) };
        if (placed.every(other => Math.hypot(other.x - candidate.x, other.y - candidate.y) >= spacing)) { found = true; break; }
      }
      if (found) break;
    }
    placed.push(candidate);
  }
  return placed;
}
