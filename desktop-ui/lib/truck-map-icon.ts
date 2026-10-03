// Cab-over dump truck silhouette. Fleet number is appended as text by the map.
export const dumpTruckMapSvg = `<svg viewBox="0 0 48 32" focusable="false" aria-hidden="true">
  <g class="truck-shape">
  <path class="truck-frame" d="M3 22h42v4H3z"/>
  <path class="truck-dump-body" d="M2 4h28V2h3v19H5z"/>
  <path class="truck-body-rails" d="M3 7h27M8 7v14M25 7v14"/>
  <path class="truck-cab" d="M33 9l4-3h7l3 10v9H32V9z"/>
  <path class="truck-window" d="M36 9h6l2 7h-9V10z"/>
  <path class="truck-cab-detail" d="M34 18h4m6 2h3m-3 2h3"/>
  <path class="truck-headlight" d="M45 17h2v3h-2z"/>
  <circle class="truck-tire" cx="11" cy="26" r="4.3"/><circle class="truck-wheel" cx="11" cy="26" r="1.8"/>
  <circle class="truck-tire" cx="39" cy="26" r="4.3"/><circle class="truck-wheel" cx="39" cy="26" r="1.8"/>
  </g>
</svg>`;

const compassHeadings = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];

/** Provider bearing is clockwise from north; the untransformed cab faces east. */
export function truckMapOrientation(heading: string | number | null | undefined) {
  const value = String(heading ?? '').trim().toUpperCase();
  const compass = compassHeadings.indexOf(value);
  const numeric = /^(?:\d+(?:\.\d+)?|\.\d+)\s*°?$/.test(value) ? Number(value.replace('°', '').trim()) : NaN;
  const bearing = compass >= 0 ? compass * 22.5 : Number.isFinite(numeric) && numeric >= 0 && numeric <= 360 ? numeric % 360 : null;
  if (bearing === null) return null;
  // Mirror westbound trucks so their wheels stay below the body, then tilt
  // the cab to the exact bearing. Text is counter-rotated separately.
  const mirrored = bearing > 180;
  return { bearing, mirrored, rotation: bearing - (mirrored ? 270 : 90),
    direction: compassHeadings[Math.round(bearing / 22.5) % 16] };
}
