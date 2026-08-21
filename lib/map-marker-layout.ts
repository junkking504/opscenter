export type MapMarkerOffset = { x: number; y: number };

type MapMarkerLayoutOptions = {
  collisionX?: number;
  collisionY?: number;
  columnGap?: number;
  rowGap?: number;
};

/**
 * Gives every nearby map marker a distinct screen-space target. Offsets are
 * measured in pixels so callers can move the visible marker and its hit target
 * together while keeping the underlying GPS point unchanged.
 */
export function mapMarkerCollisionOffsets<T>(
  records: T[],
  key: (record: T) => string,
  project: (record: T) => { x: number; y: number },
  {
    collisionX = 52,
    collisionY = 32,
    columnGap = 58,
    rowGap = 40,
  }: MapMarkerLayoutOptions = {},
): Map<string, MapMarkerOffset> {
  const points = records.map((record) => ({ record, point: project(record) }));
  const parent = points.map((_, index) => index);

  const root = (index: number): number => {
    while (parent[index] !== index) {
      parent[index] = parent[parent[index]];
      index = parent[index];
    }
    return index;
  };
  const join = (left: number, right: number) => {
    const leftRoot = root(left);
    const rightRoot = root(right);
    if (leftRoot !== rightRoot) parent[rightRoot] = leftRoot;
  };

  for (let left = 0; left < points.length; left += 1) {
    for (let right = left + 1; right < points.length; right += 1) {
      const a = points[left].point;
      const b = points[right].point;
      if (Math.abs(a.x - b.x) <= collisionX && Math.abs(a.y - b.y) <= collisionY) join(left, right);
    }
  }

  const groups = new Map<number, typeof points>();
  points.forEach((item, index) => {
    const groupRoot = root(index);
    const group = groups.get(groupRoot) || [];
    group.push(item);
    groups.set(groupRoot, group);
  });

  const offsets = new Map<string, MapMarkerOffset>();
  for (const group of groups.values()) {
    if (group.length === 1) {
      offsets.set(key(group[0].record), { x: 0, y: 0 });
      continue;
    }

    const ordered = [...group].sort((a, b) =>
      key(a.record).localeCompare(key(b.record), undefined, { numeric: true }),
    );
    const center = ordered.reduce(
      (total, item) => ({ x: total.x + item.point.x, y: total.y + item.point.y }),
      { x: 0, y: 0 },
    );
    center.x /= ordered.length;
    center.y /= ordered.length;

    const columns = Math.ceil(Math.sqrt(ordered.length));
    const rows = Math.ceil(ordered.length / columns);
    ordered.forEach((item, index) => {
      const row = Math.floor(index / columns);
      const firstInRow = row * columns;
      const rowCount = Math.min(columns, ordered.length - firstInRow);
      const column = index - firstInRow;
      const targetX = center.x + (column - (rowCount - 1) / 2) * columnGap;
      const targetY = center.y + (row - (rows - 1) / 2) * rowGap;
      offsets.set(key(item.record), {
        x: Math.round(targetX - item.point.x),
        y: Math.round(targetY - item.point.y),
      });
    });
  }

  return offsets;
}
