// Geographic anchors stay exact; only overlapping icons receive screen offsets.
export type MapPinPoint = { id: string; x: number; y: number };
export const territoryMapCenters: Record<string, [number, number]> = {
  NO: [29.95, -90.08], JP: [29.95, -90.18], NS: [30.45, -90.04],
  BR: [30.45, -91.15], LF: [30.22, -92.02],
};
type MapViewport = { left: number; top: number; right: number; bottom: number };

// One rendered icon per source location. Search the nearest free screen slot;
// offsets never change the geographic coordinates used for GPS or routing.
export function separateMapPins(points: MapPinPoint[], viewport?: MapViewport) {
  const placed: (MapPinPoint & { dx: number; dy: number })[] = [];
  const radius = Math.ceil(Math.sqrt(points.length)) + 2;
  const offsets = [];
  for (let row = -radius; row <= radius; row++) for (let column = -radius; column <= radius; column++) {
    offsets.push({ dx: column * 48, dy: row * 44 });
  }
  offsets.sort((a,b) => a.dx*a.dx+a.dy*a.dy-b.dx*b.dx-b.dy*b.dy || a.dy-b.dy || a.dx-b.dx);
  for (const point of [...points].sort((a,b) => a.id.localeCompare(b.id))) {
    const onScreen = viewport && point.x >= viewport.left && point.x <= viewport.right && point.y >= viewport.top && point.y <= viewport.bottom;
    const baseX = onScreen ? Math.max(viewport.left+24, Math.min(viewport.right-24, point.x)) : point.x;
    const baseY = onScreen ? Math.max(viewport.top+22, Math.min(viewport.bottom-22, point.y)) : point.y;
    const clear = (x: number, y: number) => placed.every(p => Math.abs(x-p.x-p.dx) >= 48 || Math.abs(y-p.y-p.dy) >= 44);
    const fits = (x: number, y: number) => !onScreen || (x >= viewport.left+24 && x <= viewport.right-24 && y >= viewport.top+22 && y <= viewport.bottom-22);
    const offset = offsets.find(p => fits(baseX+p.dx, baseY+p.dy) && clear(baseX+p.dx, baseY+p.dy))
      // Extremely small viewports may not fit every icon; retain every locator.
      || offsets.find(p => clear(baseX+p.dx, baseY+p.dy))!;
    placed.push({...point, dx: baseX+offset.dx-point.x, dy: baseY+offset.dy-point.y});
  }
  return placed;
}
