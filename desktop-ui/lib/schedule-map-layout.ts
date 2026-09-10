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
  // Only a single truck/appointment pair may separate at close zoom. Never
  // fan an entire parking lot or regional cluster across the map.
  return [...points].sort((a,b)=>a.id.localeCompare(b.id)).map(point=>{
    const nearby=nearbyMapPins(points,point.id,spacing);
    const pair=point.id.startsWith('truck:') && nearby.length===2 && nearby.some(p=>p.id.startsWith('appointment:'));
    if(!pair) return {...point,dx:0,dy:0};
    const other=nearby.find(p=>p.id!==point.id)!;
    const dx=other.x+(point.x>=other.x?spacing:-spacing)-point.x;
    const clear=points.every(p=>p.id===point.id || Math.hypot(point.x+dx-p.x,point.y-p.y)>=spacing);
    return {...point,dx:clear && Math.abs(dx)<=spacing?dx:0,dy:0};
  });

}
