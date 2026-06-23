"use client";

type DataStatusProps = {
  status: "Provisional" | "Final";
  lastUpdated?: string;
};

function formatTimestamp(value?: string) {
  if (!value) return "Not available";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Not available";
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit"
  }).format(date);
}

export function DataStatus({ status, lastUpdated }: DataStatusProps) {
  return (
    <div className="flex flex-col gap-1 text-sm text-muted sm:items-end">
      <div className="flex items-center gap-2">
        <span className="font-medium text-ink">Data status:</span>
        <span className={status === "Final" ? "text-good" : "text-warn"}>{status}</span>
      </div>
      <div>Last updated: {formatTimestamp(lastUpdated)}</div>
    </div>
  );
}
