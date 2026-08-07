import { stableUpdatedAt } from "@/lib/stable-date";

type DataStatusProps = {
  status?: string;
  lastUpdated?: string;
};

export function DataStatus({ status, lastUpdated }: DataStatusProps) {
  return (
    <div className="text-xs text-zinc-500">
      {status ? <div>{status}</div> : null}
      {lastUpdated ? <div>Last updated: {stableUpdatedAt(lastUpdated)}</div> : null}
    </div>
  );
}
