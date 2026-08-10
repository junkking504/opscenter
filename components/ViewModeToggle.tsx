"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";

type ViewModeToggleProps = {
  activeView: "daily" | "monthly" | "maintenance";
  dailyHref: string;
  monthlyHref: string;
  maintenanceHref?: string;
  dailyLabel?: string;
  monthlyLabel?: string;
  maintenanceLabel?: string;
};

export default function ViewModeToggle({
  activeView,
  dailyHref,
  monthlyHref,
  maintenanceHref,
  dailyLabel = "Daily View",
  monthlyLabel = "Monthly Summary",
  maintenanceLabel = "Maintenance",
}: ViewModeToggleProps) {
  const searchParams = useSearchParams();

  function preserveHistoricalMode(href: string) {
    if (searchParams.get("mode") !== "historical") return href;
    const separator = href.includes("?") ? "&" : "?";
    return `${href}${separator}mode=historical`;
  }

  return (
    <div className="ops-view-toggle">
      <Link href={preserveHistoricalMode(dailyHref)} className={activeView === "daily" ? "active" : ""}>
        {dailyLabel}
      </Link>
      <Link href={preserveHistoricalMode(monthlyHref)} className={activeView === "monthly" ? "active" : ""}>
        {monthlyLabel}
      </Link>
      {maintenanceHref ? (
        <Link href={preserveHistoricalMode(maintenanceHref)} className={activeView === "maintenance" ? "active" : ""}>
          {maintenanceLabel}
        </Link>
      ) : null}
    </div>
  );
}
