import type { ReactNode } from "react";
import { DateSwitcher } from "@/components/DateSwitcher";
import { DataStatus } from "@/components/DataStatus";
import { NavLink } from "@/components/NavLink";
import { reportDateOptions } from "@/lib/report-dates";

const nav = [
  { href: "/", label: "Dashboard" },
  { href: "/fleet", label: "Fleet" },
  { href: "/finance", label: "Finance" },
  { href: "/jobs", label: "Jobs" },
  { href: "/crew", label: "Crew" }
];

type ShellProps = {
  children: ReactNode;
  dataStatus: "Provisional" | "Final";
  lastUpdated?: string;
  selectedDate?: string;
};

export async function Shell({ children, dataStatus, lastUpdated, selectedDate }: ShellProps) {
  const dateOptions = await reportDateOptions();

  return (
    <div className="min-h-screen bg-surface text-ink">
      <header className="border-b border-line bg-panel">
        <div className="mx-auto flex max-w-7xl flex-col gap-4 px-4 py-5 sm:px-6 lg:flex-row lg:items-center lg:justify-between lg:px-8">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-brand/10 text-lg">👑</div>
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-brand">Junk King Operations</p>
              <h1 className="text-2xl font-semibold tracking-tight">OpsCenter</h1>
            </div>
          </div>
          <div className="flex flex-col gap-4 lg:items-end">
            <nav className="flex flex-wrap gap-2">
              {nav.map((item) => (
                <NavLink key={item.href} href={item.href} label={item.label} selectedDate={selectedDate} />
              ))}
            </nav>
            <DateSwitcher
              options={dateOptions}
              selectedDate={selectedDate}
            />
            <DataStatus status={dataStatus} lastUpdated={lastUpdated} />
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">{children}</main>
    </div>
  );
}
