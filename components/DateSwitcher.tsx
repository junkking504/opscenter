"use client";

import { usePathname, useRouter } from "next/navigation";
import type { ReportDateOption } from "@/lib/report-dates";

type DateSwitcherProps = {
  options: ReportDateOption[];
  selectedDate?: string;
};

export function DateSwitcher({ options, selectedDate }: DateSwitcherProps) {
  const pathname = usePathname();
  const router = useRouter();

  // Resolve which value is currently selected.
  // If selectedDate matches an option, use it; otherwise fall back to the first (today).
  const currentValue =
    options.find((o) => o.date === selectedDate)?.date ?? options[0]?.date ?? "";

  function handleChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const date = e.target.value;
    if (date) router.push(`${pathname}?date=${encodeURIComponent(date)}`);
  }

  return (
    <select
      value={currentValue}
      onChange={handleChange}
      className="
        w-[240px] rounded-md border border-line bg-panel px-3 py-2
        text-sm font-medium text-ink
        hover:border-brand focus:border-brand focus:outline-none
        cursor-pointer
      "
    >
      {options.map((option) => (
        <option key={option.key} value={option.date}>
          {option.date}
        </option>
      ))}
    </select>
  );
}
