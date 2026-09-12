type Point = { x: number; y: number };

/** Symmetric projected bounds keep the GPS fix centered while fitting every route. */
export function centeredExtent(center: Point, points: Point[]) {
  let width = 0, height = 0;
  for (const point of points) {
    width = Math.max(width, Math.abs(point.x - center.x));
    height = Math.max(height, Math.abs(point.y - center.y));
  }
  return {
    min: { x: center.x - width, y: center.y - height },
    max: { x: center.x + width, y: center.y + height },
  };
}
