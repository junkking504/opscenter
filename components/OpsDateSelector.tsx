"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { chicagoDateKey, addDays } from "@/lib/chicago-date";
import {
  calendarMonthCells,
  calendarMonthKey,
  calendarMonthLabel,
  shiftCalendarMonth,
} from "@/lib/date-calendar";
import styles from "./OpsDateSelector.module.css";

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

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

function fullDateLabel(date: string) {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "UTC",
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  }).format(new Date(`${date}T12:00:00Z`));
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
  const rootRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const [open, setOpen] = useState(false);
  const [visibleMonth, setVisibleMonth] = useState(calendarMonthKey(selectedDate));
  const options = useMemo(
    () => Array.from(new Set(dates.includes(selectedDate) ? dates : [selectedDate, ...dates])).sort(),
    [dates, selectedDate],
  );
  const available = useMemo(() => new Set(options), [options]);
  const today = chicagoDateKey();
  const latestCurrentDate = [...dates].sort().reverse().find((date) => date <= today) || selectedDate;
  const firstMonth = calendarMonthKey(options[0] || selectedDate);
  const lastMonth = calendarMonthKey(options.at(-1) || selectedDate);
  const cells = calendarMonthCells(visibleMonth);
  const canGoPrevious = visibleMonth > firstMonth;
  const canGoNext = visibleMonth < lastMonth;

  useEffect(() => {
    setVisibleMonth(calendarMonthKey(selectedDate));
  }, [selectedDate]);

  useEffect(() => {
    if (!open) return;
    const closeOnOutsideClick = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setOpen(false);
      triggerRef.current?.focus();
    };
    document.addEventListener("mousedown", closeOnOutsideClick);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("mousedown", closeOnOutsideClick);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [open]);

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
    setOpen(false);
    router.push(`${pathname}?${params.toString()}`);
  }

  function showMonth(offset: number) {
    const next = shiftCalendarMonth(visibleMonth, offset);
    if (next >= firstMonth && next <= lastMonth) setVisibleMonth(next);
  }

  return (
    <div ref={rootRef} className={`ops-date-selector-wrap is-calendar ${styles.wrap}`}>
      <span className={`ops-date-label ${styles.label}`}>{label}</span>
      <button
        ref={triggerRef}
        type="button"
        className={`ops-date-selector ${styles.trigger}`}
        aria-label={`${label}: ${fullDateLabel(selectedDate)}`}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls="ops-date-calendar"
        onClick={() => setOpen((current) => !current)}
      >
        <span>{optionLabel(selectedDate)}</span>
        <span className={styles.calendarIcon} aria-hidden="true">▦</span>
      </button>

      {open ? (
        <div id="ops-date-calendar" className={styles.popover} role="dialog" aria-label={`Choose ${label.toLocaleLowerCase()}`}>
          <div className={styles.header}>
            <button
              type="button"
              className={styles.monthButton}
              aria-label="Previous month"
              disabled={!canGoPrevious}
              onClick={() => showMonth(-1)}
            >
              ‹
            </button>
            <strong aria-live="polite">{calendarMonthLabel(visibleMonth)}</strong>
            <button
              type="button"
              className={styles.monthButton}
              aria-label="Next month"
              disabled={!canGoNext}
              onClick={() => showMonth(1)}
            >
              ›
            </button>
          </div>

          <div className={styles.weekdays} aria-hidden="true">
            {WEEKDAYS.map((weekday) => <span key={weekday}>{weekday}</span>)}
          </div>
          <div className={styles.grid} role="grid" aria-label={calendarMonthLabel(visibleMonth)}>
            {cells.map((cell, index) => cell ? (
              <button
                key={cell.date}
                type="button"
                className={`${styles.day}${cell.date === selectedDate ? ` ${styles.selected}` : ""}${cell.date === today ? ` ${styles.today}` : ""}`}
                aria-label={fullDateLabel(cell.date)}
                aria-pressed={cell.date === selectedDate}
                aria-current={cell.date === today ? "date" : undefined}
                disabled={!available.has(cell.date)}
                onClick={() => changeDate(cell.date)}
              >
                {cell.day}
              </button>
            ) : <span key={`empty-${index}`} className={styles.empty} aria-hidden="true" />)}
          </div>

          <div className={styles.footer}>
            <span>{options.length} available dates</span>
            <button type="button" disabled={!available.has(today)} onClick={() => changeDate(today)}>
              Today
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
