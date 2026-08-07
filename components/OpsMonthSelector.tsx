"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";

export type MonthOption = {
  key: string;
  label: string;
  date: string;
};

export default function OpsMonthSelector({
  months,
  selectedMonthKey,
  label = "Month",
}: {
  months: MonthOption[];
  selectedMonthKey: string;
  label?: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  function changeMonth(nextMonthKey: string) {
    const selected = months.find((month) => month.key === nextMonthKey) || months[0];
    if (!selected) return;

    const params = new URLSearchParams(searchParams.toString());
    params.set("date", selected.date);
    params.set("view", "monthly");
    router.push(`${pathname}?${params.toString()}`);
  }

  return (
    <div className="ops-date-selector-wrap">
      <label className="ops-date-label">{label}</label>
      <select
        className="ops-date-selector"
        value={selectedMonthKey}
        aria-label={label}
        onChange={(e) => changeMonth(e.target.value)}
      >
        {months.map((month) => (
          <option key={month.key} value={month.key}>
            {month.label}
          </option>
        ))}
      </select>
    </div>
  );
}
