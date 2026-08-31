"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { opsNavigationItems } from "@/components/navItems";
import { titleCaseLabel } from "@/lib/title-case";
import { authorizeOpsRequest, type InteractiveOpsRole } from "@/lib/ops-roles";

type SidebarSubItem = {
  label: string;
  href: string;
  active: boolean;
};

type SearchParamReader = Pick<URLSearchParams, "get">;

function sidebarHref(
  pathname: string,
  searchParams: SearchParamReader,
  values: Record<string, string | undefined>,
  options: { includeDate?: boolean; preserveJobFilters?: boolean } = {},
) {
  const params = new URLSearchParams();
  const date = searchParams.get("date");

  if (options.includeDate !== false && date) params.set("date", date);
  if (searchParams.get("mode") === "historical") params.set("mode", "historical");

  if (options.preserveJobFilters) {
    for (const key of ["territory", "status", "paymentType", "truck", "q", "siteTime"]) {
      const value = searchParams.get(key);
      if (value) params.set(key, value);
    }
  }

  for (const [key, value] of Object.entries(values)) {
    if (value) params.set(key, value);
  }

  const query = params.toString();
  return query ? `${pathname}?${query}` : pathname;
}

function sidebarSubItems(pathname: string, searchParams: SearchParamReader): SidebarSubItem[] {
  const rawView = searchParams.get("view")?.toLowerCase();
  const view = pathname.startsWith("/finance")
    ? rawView === "monthly" ? "monthly" : "daily"
    : rawView === "monthly" || rawView === "maintenance" ? rawView : "daily";
  const requestedSection = searchParams.get("section")?.toLowerCase() || "";

  if (pathname === "/") {
    if (view === "monthly") {
      const section = ["territory", "comparison"].includes(requestedSection) ? requestedSection : "overview";
      return [
        { label: "Overview", href: sidebarHref("/", searchParams, { view: "monthly", section: "overview" }), active: section === "overview" },
        { label: "Territory", href: sidebarHref("/", searchParams, { view: "monthly", section: "territory" }), active: section === "territory" },
        { label: "Comparison", href: sidebarHref("/", searchParams, { view: "monthly", section: "comparison" }), active: section === "comparison" },
        { label: "Daily", href: sidebarHref("/", searchParams, {}), active: false },
      ];
    }

    const section = ["crew", "fleet"].includes(requestedSection) ? requestedSection : "overview";
    return [
      { label: "Overview", href: sidebarHref("/", searchParams, { section: "overview" }), active: section === "overview" },
      { label: "Krewe Snapshot", href: sidebarHref("/", searchParams, { section: "crew" }), active: section === "crew" },
      { label: "Fleet Snapshot", href: sidebarHref("/", searchParams, { section: "fleet" }), active: section === "fleet" },
      { label: "Monthly", href: sidebarHref("/", searchParams, { view: "monthly" }), active: false },
    ];
  }

  if (pathname.startsWith("/jobs")) {
    const href = (values: Record<string, string | undefined>) =>
      sidebarHref("/jobs", searchParams, values, { preserveJobFilters: true });

    if (view === "monthly") {
      const section = ["breakdown", "trend"].includes(requestedSection) ? requestedSection : "overview";
      return [
        { label: "Schedule", href: href({}), active: false },
        { label: "Monthly overview", href: href({ view: "monthly", section: "overview" }), active: section === "overview" },
        { label: "Breakdown", href: href({ view: "monthly", section: "breakdown" }), active: section === "breakdown" },
        { label: "Trend", href: href({ view: "monthly", section: "trend" }), active: section === "trend" },
      ];
    }

    return [
      { label: "Schedule", href: href({}), active: true },
      { label: "Monthly", href: href({ view: "monthly" }), active: false },
    ];
  }

  if (pathname.startsWith("/marketing")) {
    const section = ["territory", "calls", "lost-leads"].includes(requestedSection) ? requestedSection : "overview";
    return [
      { label: "Overview", href: sidebarHref("/marketing", searchParams, { section: "overview" }), active: section === "overview" },
      { label: "Territory", href: sidebarHref("/marketing", searchParams, { section: "territory" }), active: section === "territory" },
      { label: "Calls", href: sidebarHref("/marketing", searchParams, { section: "calls" }), active: section === "calls" },
      { label: "Lost Leads", href: sidebarHref("/marketing", searchParams, { section: "lost-leads" }), active: section === "lost-leads" },
    ];
  }

  if (pathname.startsWith("/crew")) {
    if (view === "monthly") {
      const section = requestedSection === "breakdown" ? "breakdown" : "overview";
      return [
        { label: "Daily krewe", href: sidebarHref("/crew", searchParams, {}), active: false },
        { label: "Monthly overview", href: sidebarHref("/crew", searchParams, { view: "monthly", section: "overview" }), active: section === "overview" },
        { label: "Krewe breakdown", href: sidebarHref("/crew", searchParams, { view: "monthly", section: "breakdown" }), active: section === "breakdown" },
      ];
    }

    const section = ["call-in", "pay-period"].includes(requestedSection) ? requestedSection : "crew";
    return [
      { label: "Call-in plan", href: sidebarHref("/crew", searchParams, { section: "call-in" }), active: section === "call-in" },
      { label: "Today’s krewe", href: sidebarHref("/crew", searchParams, { section: "crew" }), active: section === "crew" },
      { label: "Pay period", href: sidebarHref("/crew", searchParams, { section: "pay-period" }), active: section === "pay-period" },
      { label: "Monthly", href: sidebarHref("/crew", searchParams, { view: "monthly" }), active: false },
    ];
  }

  if (pathname.startsWith("/fleet")) {
    if (view === "maintenance") {
      const section = ["checklists", "service", "reports", "records"].includes(requestedSection) ? requestedSection : "overview";
      return [
        { label: "Live fleet", href: sidebarHref("/fleet", searchParams, {}), active: false },
        { label: "Maintenance overview", href: sidebarHref("/fleet", searchParams, { view: "maintenance", section: "overview" }), active: section === "overview" },
        { label: "Checklists", href: sidebarHref("/fleet", searchParams, { view: "maintenance", section: "checklists" }), active: section === "checklists" },
        { label: "Service planner", href: sidebarHref("/fleet", searchParams, { view: "maintenance", section: "service" }), active: section === "service" },
        { label: "Reports", href: sidebarHref("/fleet", searchParams, { view: "maintenance", section: "reports" }), active: section === "reports" },
        { label: "Records", href: sidebarHref("/fleet", searchParams, { view: "maintenance", section: "records" }), active: section === "records" },
        { label: "Monthly", href: sidebarHref("/fleet", searchParams, { view: "monthly" }), active: false },
      ];
    }

    if (view === "monthly") {
      const section = ["drivers", "trucks", "quality"].includes(requestedSection) ? requestedSection : "daily";
      return [
        { label: "Live fleet", href: sidebarHref("/fleet", searchParams, {}), active: false },
        { label: "Daily overview", href: sidebarHref("/fleet", searchParams, { view: "monthly", section: "daily" }), active: section === "daily" },
        { label: "Drivers", href: sidebarHref("/fleet", searchParams, { view: "monthly", section: "drivers" }), active: section === "drivers" },
        { label: "Trucks", href: sidebarHref("/fleet", searchParams, { view: "monthly", section: "trucks" }), active: section === "trucks" },
        { label: "Data quality", href: sidebarHref("/fleet", searchParams, { view: "monthly", section: "quality" }), active: section === "quality" },
        { label: "Maintenance", href: sidebarHref("/fleet", searchParams, { view: "maintenance" }), active: false },
      ];
    }

    const section = ["map", "scores"].includes(requestedSection) ? requestedSection : "overview";
    return [
      { label: "Overview", href: sidebarHref("/fleet", searchParams, { section: "overview" }), active: section === "overview" },
      { label: "Live map", href: sidebarHref("/fleet", searchParams, { section: "map" }), active: section === "map" },
      { label: "Driving scores", href: sidebarHref("/fleet", searchParams, { section: "scores" }), active: section === "scores" },
      { label: "Maintenance", href: sidebarHref("/fleet", searchParams, { view: "maintenance" }), active: false },
      { label: "Monthly", href: sidebarHref("/fleet", searchParams, { view: "monthly" }), active: false },
    ];
  }

  if (pathname.startsWith("/finance")) {
    if (view === "monthly") {
      const section = ["reconciliation", "expenses", "territory", "trend", "resale"].includes(requestedSection) ? requestedSection : "overview";
      return [
        { label: "Daily close", href: sidebarHref("/finance", searchParams, { view: "daily" }), active: false },
        { label: "P&L summary", href: sidebarHref("/finance", searchParams, { view: "monthly", section: "overview" }), active: section === "overview" },
        { label: "Payments & recon", href: sidebarHref("/finance", searchParams, { view: "monthly", section: "reconciliation" }), active: section === "reconciliation" },
        { label: "Costs", href: sidebarHref("/finance", searchParams, { view: "monthly", section: "expenses" }), active: section === "expenses" },
        { label: "Territory", href: sidebarHref("/finance", searchParams, { view: "monthly", section: "territory" }), active: section === "territory" },
        { label: "Trend", href: sidebarHref("/finance", searchParams, { view: "monthly", section: "trend" }), active: section === "trend" },
        { label: "Resale inventory", href: sidebarHref("/finance", searchParams, { view: "monthly", section: "resale" }), active: section === "resale" },
      ];
    }

    const dailySection = requestedSection === "reconciliation" ? "payments" : requestedSection;
    const section = ["payments", "expenses", "trucks", "resale"].includes(dailySection) ? dailySection : "overview";
    return [
      { label: "Daily summary", href: sidebarHref("/finance", searchParams, { view: "daily", section: "overview" }), active: section === "overview" },
      { label: "Payments & recon", href: sidebarHref("/finance", searchParams, { view: "daily", section: "payments" }), active: section === "payments" },
      { label: "Company costs", href: sidebarHref("/finance", searchParams, { view: "daily", section: "expenses" }), active: section === "expenses" },
      { label: "Truck records", href: sidebarHref("/finance", searchParams, { view: "daily", section: "trucks" }), active: section === "trucks" },
      { label: "Resale inventory", href: sidebarHref("/finance", searchParams, { view: "daily", section: "resale" }), active: section === "resale" },
      { label: "Month to date", href: sidebarHref("/finance", searchParams, { view: "monthly" }), active: false },
    ];
  }

  return [];
}

function roleVisibleSubItems(items: SidebarSubItem[], role: InteractiveOpsRole): SidebarSubItem[] {
  return items.filter((item) => {
    const target = new URL(item.href, "http://opscenter.local");
    return authorizeOpsRequest(role, target.pathname, "GET", target.searchParams).allowed;
  });
}

export default function OpsNav({
  variant = "tabs",
  inboxEnabled = false,
  role = "admin",
}: {
  variant?: "tabs" | "sidebar" | "bottom";
  inboxEnabled?: boolean;
  role?: InteractiveOpsRole;
}) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const navigationItems = opsNavigationItems(role, inboxEnabled);

  const date = searchParams.get("date");
  const mode = searchParams.get("mode");

  function hrefWithDate(href: string) {
    const params = new URLSearchParams();
    const today = new Intl.DateTimeFormat("en-CA", {
      timeZone: "America/Chicago",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date());
    const dateBelongsOnTarget = !date || date <= today || href === "/jobs";

    if (date && dateBelongsOnTarget) {
      params.set("date", date);
    }
    if (mode === "historical") {
      params.set("mode", mode);
    }

    const query = params.toString();
    return query ? `${href}?${query}` : href;
  }

  if (variant === "bottom") {
    return (
      <nav className="ops-bottom-nav" aria-label="Primary navigation">
        {navigationItems.map((item) => {
          const active = item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
          return (
            <Link
              key={item.href}
              href={hrefWithDate(item.href)}
              prefetch={false}
              className={`ops-bottom-nav-item${active ? " active" : ""}`}
              aria-current={active ? "page" : undefined}
            >
              <span>{item.icon}</span>
              <small>{titleCaseLabel(item.mobileLabel)}</small>
            </Link>
          );
        })}
      </nav>
    );
  }

  return (
    <nav className={variant === "sidebar" ? "ops-nav" : "ops-tabs"}>
      {navigationItems.map((item) => {
        const active =
          item.href === "/"
            ? pathname === "/"
            : pathname.startsWith(item.href);

        if (variant !== "sidebar") {
          return (
            <Link
              key={item.href}
              href={hrefWithDate(item.href)}
              prefetch={false}
              className={`ops-tab${active ? " active" : ""}`}
              aria-current={active ? "page" : undefined}
            >
              <span>{titleCaseLabel(item.label)}</span>
            </Link>
          );
        }

        const subItems = active ? roleVisibleSubItems(sidebarSubItems(pathname, searchParams), role) : [];
        return (
          <div key={item.href} className={`ops-nav-group${active ? " active" : ""}`}>
            <Link
              href={hrefWithDate(item.href)}
              prefetch={false}
              className={`ops-nav-item${active ? " active" : ""}`}
              aria-current={active ? "page" : undefined}
            >
              <span className="ops-nav-icon">{item.icon}</span>
              <span>{titleCaseLabel(item.label)}</span>
            </Link>
            {subItems.length ? (
              <div className="ops-nav-subitems" role="group" aria-label={`${titleCaseLabel(item.label)} views`}>
                {subItems.map((subItem) => (
                  <Link
                    key={subItem.href}
                    href={subItem.href}
                    prefetch={false}
                    className={`ops-nav-subitem${subItem.active ? " active" : ""}`}
                    aria-current={subItem.active ? "page" : undefined}
                  >
                    {titleCaseLabel(subItem.label)}
                  </Link>
                ))}
              </div>
            ) : null}
          </div>
        );
      })}
    </nav>
  );
}
