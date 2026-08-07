"use client";

export default function PageRefreshButton({ label = "Refresh" }: { label?: string }) {
  return (
    <button
      type="button"
      className="ops-refresh-button"
      onClick={() => window.location.reload()}
    >
      {label}
    </button>
  );
}
