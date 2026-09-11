export const territoryMapCenters: Record<string, [number, number]> = {
  NO: [29.95, -90.08], JP: [29.95, -90.18], NS: [30.45, -90.04],
  RP: [30.02, -90.45], BR: [30.45, -91.15], LF: [30.22, -92.02],
};

export type LocatorPoint = { id: string; x: number; y: number };

export function locatorSize(zoom: number) { return zoom >= 16 ? 32 : zoom >= 13 ? 26 : 20; }

// Layout uses screen pixels only. Source coordinates and GPS matching never move.
// Stable identity order prevents selection or source array ordering from swapping icons.
export function separateMapLocators(points: LocatorPoint[], size: number, viewport: { x: number; y: number }) {
  const gap = size + 4;
  const inset = size / 2 + 6;
  const ordered = [...points].sort((a, b) => a.id.localeCompare(b.id));
  const overflowPoint = { x: viewport.x - inset, y: viewport.y - inset };
  const layout = (reserveOverflow: boolean) => {
    const positions = new Map<string, { x: number; y: number }>();
    const occupied = reserveOverflow ? [overflowPoint] : [];
    const overflow: string[] = [];
    const free = (p: { x: number; y: number }) => occupied.every(other => Math.abs(p.x - other.x) >= gap || Math.abs(p.y - other.y) >= gap);
    // A shared grid supplies a bounded fallback for dense areas and edge pins.
    const slots: { x: number; y: number }[] = [];
    for (let x = inset; x <= viewport.x - inset; x += gap) for (let y = inset; y <= viewport.y - inset; y += gap) slots.push({ x, y });
    for (const point of ordered) {
      const origin = { x: Math.max(inset, Math.min(viewport.x - inset, point.x)), y: Math.max(inset, Math.min(viewport.y - inset, point.y)) };
      const candidates = [origin, ...slots];
      // Prefer the nearest free position, including immediately beside an icon.
      for (const other of occupied) for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
        const candidate = { x: other.x + dx * gap, y: other.y + dy * gap };
        if (candidate.x >= inset && candidate.y >= inset && candidate.x <= viewport.x - inset && candidate.y <= viewport.y - inset) candidates.push(candidate);
      }
      candidates.sort((a, b) => Math.hypot(a.x - point.x, a.y - point.y) - Math.hypot(b.x - point.x, b.y - point.y));
      const position = candidates.find(free);
      if (position) { positions.set(point.id, position); occupied.push(position); }
      else overflow.push(point.id);
    }
    return { positions, overflow, overflowPoint };
  };
  const result = layout(false);
  // When individual targets cannot all fit, keep the remainder reachable in a
  // single separated count button rather than clipping or stacking them.
  return result.overflow.length ? layout(true) : result;
}
