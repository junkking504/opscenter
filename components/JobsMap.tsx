import type { Appointment } from "@/types/metrics";

type JobsMapProps = {
  appointments: Appointment[];
};

type Point = Appointment & {
  x: number;
  y: number;
  fill: string;
  exact: boolean;
};

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function project(value: number, min: number, max: number, size: number, padding: number): number {
  if (max === min) return size / 2;
  return padding + ((value - min) / (max - min)) * (size - padding * 2);
}

function statusLabel(a: Appointment): string {
  const type = (a.appointment_type ?? "").toLowerCase();
  const status = (a.job_status ?? "").toLowerCase();
  if (type === "estimate") return "Estimate";
  if (status.startsWith("completed")) return "Completed";
  if (status === "confirmed") return "Confirmed";
  return a.job_status ?? "Unknown";
}

function fallbackCoords(market?: string): { lat: number; lng: number } {
  const label = (market ?? "").toLowerCase();
  if (label.includes("northshore")) return { lat: 30.418, lng: -90.090 };
  if (label.includes("baton rouge")) return { lat: 30.451, lng: -91.186 };
  if (label.includes("jefferson")) return { lat: 29.952, lng: -90.171 };
  return { lat: 29.951, lng: -90.072 }; // New Orleans
}

export function JobsMap({ appointments }: JobsMapProps) {
  const points = appointments
    .map((a) => {
      const exact = isFiniteNumber(a.lat) && isFiniteNumber(a.lng);
      const fallback = fallbackCoords(a.market);
      return {
        ...a,
        lat: exact ? (a.lat as number) : fallback.lat,
        lng: exact ? (a.lng as number) : fallback.lng,
        exact
      };
    });

  if (!points.length) {
    return (
      <div className="flex h-[26rem] items-center justify-center rounded-lg border border-dashed border-line bg-surface text-sm text-muted">
        No geocoded job locations yet
      </div>
    );
  }

  const width = 1000;
  const height = 680;
  const padding = 44;

  const lats = points.map((p) => p.lat as number);
  const lngs = points.map((p) => p.lng as number);
  const minLat = Math.min(...lats);
  const maxLat = Math.max(...lats);
  const minLng = Math.min(...lngs);
  const maxLng = Math.max(...lngs);
  const latPad = Math.max((maxLat - minLat) * 0.15, 0.02);
  const lngPad = Math.max((maxLng - minLng) * 0.15, 0.02);

  const plotted: Point[] = points.map((a) => {
    const x = project(a.lng as number, minLng - lngPad, maxLng + lngPad, width, padding);
    const y = height - project(a.lat as number, minLat - latPad, maxLat + latPad, height, padding);
    const fill = (a.appointment_type ?? "").toLowerCase() === "estimate" ? "var(--warn)" : "var(--brand)";
    return { ...a, x, y, fill };
  });

  const xTicks = Array.from({ length: 5 }, (_, i) => minLng - lngPad + ((maxLng + lngPad - (minLng - lngPad)) / 4) * i);
  const yTicks = Array.from({ length: 5 }, (_, i) => minLat - latPad + ((maxLat + latPad - (minLat - latPad)) / 4) * i);

  return (
    <div className="overflow-hidden rounded-lg border border-line bg-panel">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-4 py-3">
        <div>
          <p className="text-sm font-semibold text-ink">Appointment Map</p>
          <p className="text-xs text-muted">
            {points.length} appointments · {points.filter((p) => p.exact).length} exact ·{" "}
            {points.filter((p) => !p.exact).length} approximate
          </p>
        </div>
        <div className="flex flex-wrap gap-3 text-xs text-muted">
          <span className="inline-flex items-center gap-2">
            <span className="h-2.5 w-2.5 rounded-full bg-[rgb(var(--brand))]" />
            Exact jobs
          </span>
          <span className="inline-flex items-center gap-2">
            <span className="h-2.5 w-2.5 rounded-full bg-[rgb(var(--warn))]" />
            Estimates
          </span>
          <span className="inline-flex items-center gap-2">
            <span className="h-2.5 w-2.5 rounded-full border border-[rgb(var(--muted))]" />
            Approximate
          </span>
        </div>
      </div>
      <div className="bg-[#0d1117]">
        <svg viewBox={`0 0 ${width} ${height}`} className="h-[26rem] w-full">
          <defs>
            <linearGradient id="jobs-map-bg" x1="0" x2="0" y1="0" y2="1">
              <stop offset="0%" stopColor="rgb(17 24 39)" />
              <stop offset="100%" stopColor="rgb(10 14 20)" />
            </linearGradient>
            <pattern id="jobs-map-grid" width="80" height="80" patternUnits="userSpaceOnUse">
              <path d="M 80 0 L 0 0 0 80" fill="none" stroke="rgb(255 255 255 / 0.06)" strokeWidth="1" />
            </pattern>
          </defs>

          <rect x="0" y="0" width={width} height={height} fill="url(#jobs-map-bg)" />
          <rect x="0" y="0" width={width} height={height} fill="url(#jobs-map-grid)" />

          {xTicks.map((tick, index) => {
            const x = project(tick, minLng - lngPad, maxLng + lngPad, width, padding);
            return (
              <g key={`x-${index}`}>
                <line x1={x} y1={padding} x2={x} y2={height - padding} stroke="rgb(255 255 255 / 0.06)" />
                <text x={x} y={height - 16} textAnchor="middle" fill="rgb(148 163 184)" fontSize="14">
                  {tick.toFixed(3)}
                </text>
              </g>
            );
          })}

          {yTicks.map((tick, index) => {
            const y = height - project(tick, minLat - latPad, maxLat + latPad, height, padding);
            return (
              <g key={`y-${index}`}>
                <line x1={padding} y1={y} x2={width - padding} y2={y} stroke="rgb(255 255 255 / 0.06)" />
                <text x={18} y={y + 4} fill="rgb(148 163 184)" fontSize="14">
                  {tick.toFixed(3)}
                </text>
              </g>
            );
          })}

          {plotted.map((point) => (
            <g key={point.job_id ?? `${point.customer_name}-${point.x}-${point.y}`}>
              <title>
                {[
                  point.customer_name || "Unknown",
                  point.address || "No address",
                  point.truck || "Unassigned",
                  statusLabel(point),
                  point.exact ? "Exact location" : "Approximate market location",
                  point.revenue ? `Revenue: ${point.revenue}` : null
                ]
                  .filter(Boolean)
                  .join("\n")}
              </title>
              <circle
                cx={point.x}
                cy={point.y}
                r={point.appointment_type?.toLowerCase() === "estimate" ? 7 : 8}
                fill={point.fill}
                stroke="rgb(15 18 24)"
                strokeWidth="3"
                opacity={point.appointment_type?.toLowerCase() === "estimate" ? 0.8 : point.exact ? 1 : 0.55}
                strokeDasharray={point.exact ? "0" : "4 3"}
              />
              {point.appointment_type?.toLowerCase() !== "estimate" ? (
                <circle cx={point.x} cy={point.y} r={16} fill={point.fill} opacity={point.exact ? "0.15" : "0.08"} />
              ) : null}
            </g>
          ))}
        </svg>
      </div>
    </div>
  );
}
