type LeafletModule = typeof import("leaflet");

type TruckMapMarkerOptions = {
  atJob?: boolean;
  labelOffset?: number;
  selected?: boolean;
};

function escapeHtml(value: string): string {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function truckMapLabel(value: string): string {
  const raw = String(value || "").trim();
  const number = raw.match(/(\d+)/)?.[1];
  return number ? `Truck #${number}` : raw;
}

function truckMapShortLabel(value: string): string {
  const raw = String(value || "").trim();
  const number = raw.match(/(\d+)/)?.[1];
  return number ? `T${number}` : raw;
}

export function truckMapMarkerOffsets<T>(
  records: T[],
  key: (record: T) => string,
  project: (record: T) => { x: number; y: number },
): Map<string, number> {
  const groups: T[][] = [];

  for (const record of records) {
    const point = project(record);
    const nearbyGroup = groups.find((group) => group.some((candidate) => {
      const candidatePoint = project(candidate);
      return Math.abs(point.x - candidatePoint.x) <= 52 && Math.abs(point.y - candidatePoint.y) <= 28;
    }));

    if (nearbyGroup) nearbyGroup.push(record);
    else groups.push([record]);
  }

  const offsets = new Map<string, number>();
  for (const group of groups) {
    const ordered = [...group].sort((a, b) => key(a).localeCompare(key(b), undefined, { numeric: true }));
    ordered.forEach((record, index) => {
      offsets.set(key(record), (index - (ordered.length - 1) / 2) * 30);
    });
  }
  return offsets;
}

export function truckMapMarkerIcon(
  leaflet: LeafletModule,
  truck: string,
  { atJob = false, labelOffset = 0, selected = false }: TruckMapMarkerOptions = {},
) {
  const iconAnchorY = 21 - labelOffset;
  const leaderTop = Math.min(21, iconAnchorY);
  const label = truckMapLabel(truck);
  const shortLabel = truckMapShortLabel(truck);
  const html = `
    <div class="ops-truck-map-marker-locator">
      ${labelOffset === 0 ? "" : `
        <span class="ops-truck-map-marker-origin" style="top:${17 - labelOffset}px"></span>
        <span class="ops-truck-map-marker-leader" style="top:${leaderTop}px;height:${Math.abs(labelOffset)}px"></span>
      `}
      <div
        class="ops-truck-map-marker${selected ? " is-selected" : ""}${atJob ? " is-at-job" : ""}"
        aria-hidden="true"
        title="${escapeHtml(label)}"
      >
        <svg viewBox="0 0 28 18" aria-hidden="true">
          <path d="M2 3h14v10H2zM16 7h5l4 4v2h-9z"/>
          <circle cx="7" cy="14" r="2.5"/>
          <circle cx="21" cy="14" r="2.5"/>
        </svg>
        <b>${escapeHtml(shortLabel)}</b>
      </div>
    </div>
  `;

  return leaflet.divIcon({
    className: "ops-truck-map-div-icon",
    html,
    iconSize: [46, 28],
    iconAnchor: [22, iconAnchorY],
    popupAnchor: [0, -22],
    tooltipAnchor: [0, -22],
  });
}
