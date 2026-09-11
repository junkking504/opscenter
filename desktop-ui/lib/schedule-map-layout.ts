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

// Recheck rendered footprints so a group badge cannot cover its neighbors.
export function groupMapPins(points: MapPinPoint[]) {
  const groups = [...points].sort((a,b)=>a.id.localeCompare(b.id)).map(point=>[point]);
  const footprint = (members: MapPinPoint[]) => ({
    x: members.reduce((n,p)=>n+p.x,0)/members.length,
    y: members.reduce((n,p)=>n+p.y,0)/members.length,
    width: members.length===1 ? 46 : members.length===2 ? 94 : 90,
    height: 42,
  });
  let merged = true;
  while (merged) {
    merged = false;
    outer: for (let i=0;i<groups.length;i++) for (let j=i+1;j<groups.length;j++) {
      const a=footprint(groups[i]), b=footprint(groups[j]);
      if (Math.abs(a.x-b.x)<(a.width+b.width)/2+4 && Math.abs(a.y-b.y)<(a.height+b.height)/2+4) {
        groups[i]=[...groups[i],...groups[j]].sort((a,b)=>a.id.localeCompare(b.id));
        groups.splice(j,1); merged=true; break outer;
      }
    }
  }
  return groups.map(members=>({...footprint(members), members}));
}
