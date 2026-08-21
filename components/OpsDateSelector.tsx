"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { chicagoDateKey, addDays } from "@/lib/chicago-date";

function optionLabel(date: string) {
  const today = chicagoDateKey();
  const formattedDate = new Intl.DateTimeFormat("en-US", {
    timeZone: "UTC",
    weekday: "short",
    month: "short",
    day: "numeric",
  })
    .format(new Date(`${date}T12:00:00Z`))
    .replace(",", "");

  if (date === today) return `Today · ${formattedDate}`;
  if (date === addDays(today, 1)) return `Tomorrow · ${formattedDate}`;
  return formattedDate;
}

export default function OpsDateSelector({
  dates,
  selectedDate,
  label = "Date",
}: {
  dates: string[];
  selectedDate: string;
  label?: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const options = dates.includes(selectedDate) ? dates : [selectedDate, ...dates];
  const today = chicagoDateKey();
  const latestCurrentDate = dates.find((date) => date <= today) || selectedDate;

  function changeDate(nextDate: string) {
    const params = new URLSearchParams(searchParams.toString());
    params.set("date", nextDate);
    if (nextDate === latestCurrentDate) {
      params.delete("mode");
    } else {
      // Historical browsing is explicit. Automatic freshness updates resume as
      // soon as the operator selects the current date again.
      params.set("mode", "historical");
    }

    // Stay on the current page instead of returning to Dashboard.
    router.push(`${pathname}?${params.toString()}`);
  }

  return (
    <div className="ops-date-selector-wrap">
      <label className="ops-date-label">{label}</label>
      <select
        className="ops-date-selector"
        value={selectedDate}
        aria-label={label}
        onChange={(e) => changeDate(e.target.value)}
      >
        {options.map((date) => (
          <option key={date} value={date}>
            {optionLabel(date)}
          </option>
        ))}
      </select>
    </div>
  );
}
