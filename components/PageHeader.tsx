import OpsDateSelector from "@/components/OpsDateSelector";
import PageRefreshButton from "@/components/PageRefreshButton";
import CurrentDataSync from "@/components/CurrentDataSync";
import { availableDates } from "@/lib/opsData";
import { stableUpdatedAt } from "@/lib/stable-date";
import { titleCaseLabel } from "@/lib/title-case";
import { Suspense, type ReactNode } from "react";
import styles from "./PageHeader.module.css";

export default function PageHeader({
  title,
  subtitle,
  date,
  showDateSelector = true,
  showRefresh = true,
  lastUpdated,
  controls,
  status,
  dateLabel = "Date",
  dates,
  sections,
  compact = false,
}: {
  title: string;
  subtitle?: string;
  date: string;
  showDateSelector?: boolean;
  showRefresh?: boolean;
  lastUpdated?: string | null;
  controls?: ReactNode;
  status?: string;
  dateLabel?: string;
  dates?: string[];
  sections?: Array<{
    label: string;
    href: string;
    active?: boolean;
    badge?: string | number;
    attention?: boolean;
  }>;
  compact?: boolean;
}) {
  const updated = lastUpdated ? stableUpdatedAt(lastUpdated) : "";

  return (
    <section className={`ops-control-strip ops-page-header${sections?.length ? " has-subnav" : ""}${compact ? ` ${styles.compact}` : ""}`}>
      <Suspense fallback={null}>
        <CurrentDataSync selectedDate={date} initialUpdatedAt={lastUpdated} />
      </Suspense>
      <div className="ops-page-header-copy">
        <h1 className="ops-page-title">{titleCaseLabel(title)}</h1>
        {subtitle ? <div className="ops-muted ops-page-header-subtitle">{subtitle}</div> : null}
      </div>

      <div className="ops-page-header-controls">
        {showDateSelector ? (
          <OpsDateSelector dates={dates || availableDates()} selectedDate={date} label={dateLabel} />
        ) : null}
        {controls}
        {showRefresh ? <PageRefreshButton /> : null}
      </div>

      {status || updated ? (
        <div className="ops-page-header-meta">
          {status ? <span className="ops-page-header-status">{status}</span> : null}
          {updated ? <span className="ops-page-header-updated">Last updated: {updated}</span> : null}
        </div>
      ) : null}

      {sections?.length ? (
        <nav className="ops-page-subnav" aria-label={`${title} sections`}>
          {sections.map((section) => (
            <a
              key={`${section.label}-${section.href}`}
              href={section.href}
              className={`${section.active ? "active" : ""}${section.attention ? " needs-attention" : ""}`}
              aria-current={section.active ? "page" : undefined}
            >
              <span>{titleCaseLabel(section.label)}</span>
              {section.badge !== undefined ? <small>{section.badge}</small> : null}
            </a>
          ))}
        </nav>
      ) : null}
    </section>
  );
}
