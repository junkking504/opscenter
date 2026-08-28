"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { chicagoDateKey } from "@/lib/chicago-date";

export type MonthOption = {
  key: string;
  label: string;
  date: string;
};

export default function OpsMonthSelector({
  months,
  selectedMonthKey,
  label = "Month",
  currentMonthKey,
}: {
  months: MonthOption[];
  selectedMonthKey: string;
  label?: string;
  currentMonthKey?: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const selectableMonths = months.some((month) => month.key === selectedMonthKey)
    ? months
    : [
        {
          key: selectedMonthKey,
          label: new Date(`${selectedMonthKey}-01T12:00:00Z`).toLocaleDateString("en-US", {
            month: "long",
            year: "numeric",
            timeZone: "UTC",
          }),
          date: `${selectedMonthKey}-01`,
        },
        ...months,
      ].sort((a, b) => b.key.localeCompare(a.key));

  function changeMonth(nextMonthKey: string) {
    if (!/^\d{4}-\d{2}$/.test(nextMonthKey)) return;

    const params = new URLSearchParams(searchParams.toString());
    params.set("date", `${nextMonthKey}-01`);
    params.set("view", searchParams.get("view") === "calendar" ? "calendar" : "monthly");
    params.delete("day");
    // CurrentDataSync advances live pages to the freshest metrics date. A
    // month chosen from history must opt out before that poll can replace the
    // newly selected month with the current one.
    if (nextMonthKey === chicagoDateKey().slice(0, 7)) {
      params.delete("mode");
    } else {
      params.set("mode", "historical");
    }
    router.push(`${pathname}?${params.toString()}`);
  }

  function shiftMonth(offset: number) {
    const [year, month] = selectedMonthKey.split("-").map(Number);
    const next = new Date(Date.UTC(year, month - 1 + offset, 1));
    changeMonth(`${next.getUTCFullYear()}-${String(next.getUTCMonth() + 1).padStart(2, "0")}`);
  }

  return (
    <div className="ops-month-selector-group">
      <button type="button" className="ops-month-nav-button" onClick={() => shiftMonth(-1)} aria-label="Previous month">
        <span aria-hidden="true">←</span>
      </button>
      <div className="ops-date-selector-wrap">
        <label className="ops-date-label">{label}</label>
        <select
          className="ops-date-selector"
          value={selectedMonthKey}
          aria-label={label}
          onChange={(e) => changeMonth(e.target.value)}
        >
          {selectableMonths.map((month) => (
            <option key={month.key} value={month.key}>
              {month.label}
            </option>
          ))}
        </select>
      </div>
      <button type="button" className="ops-month-nav-button" onClick={() => shiftMonth(1)} aria-label="Next month">
        <span aria-hidden="true">→</span>
      </button>
      {currentMonthKey && currentMonthKey !== selectedMonthKey ? (
        <button type="button" className="ops-month-today-button" onClick={() => changeMonth(currentMonthKey)}>
          This month
        </button>
      ) : null}
    </div>
  );
}
