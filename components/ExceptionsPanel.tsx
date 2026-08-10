"use client";

import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import type { OperationalExceptionsReport, ExceptionCategory, ExceptionSeverity } from "@/lib/operational-exceptions";

const severityLabels: Record<ExceptionSeverity, string> = {
  critical: "Critical",
  warning: "Warning",
  info: "Info",
};

const categoryOrder: ExceptionCategory[] = ["Crew", "Jobs", "Fleet", "Finance"];

function todayIsoChicago(): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Chicago",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function sourceDate(dateParam: string | null): string {
  return dateParam && /^\d{4}-\d{2}-\d{2}$/.test(dateParam) ? dateParam : todayIsoChicago();
}

function severityClass(severity: ExceptionSeverity): string {
  return severity === "critical" ? "ops-exception-critical" : severity === "warning" ? "ops-exception-warning" : "ops-exception-info";
}

type ExceptionsPanelProps = {
  compact?: boolean;
};

export default function ExceptionsPanel({ compact = false }: ExceptionsPanelProps) {
  const [report, setReport] = useState<OperationalExceptionsReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshToken, setRefreshToken] = useState(0);
  const [expanded, setExpanded] = useState(false);
  const [expandedCategories, setExpandedCategories] = useState<Set<ExceptionCategory>>(new Set());

  const searchParams = useSearchParams();
  const date = sourceDate(searchParams.get("date"));

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError(null);

    fetch(`/api/exceptions?date=${encodeURIComponent(date)}`, {
      signal: controller.signal,
      cache: "no-store",
    })
      .then(async (response) => {
        if (!response.ok) {
          throw new Error(`Unable to load exceptions (${response.status})`);
        }
        return response.json();
      })
      .then((payload: OperationalExceptionsReport) => setReport(payload))
      .catch((err: Error) => {
        if (err.name === "AbortError") return;
        setError(err.message || "Unable to load exceptions");
      })
      .finally(() => setLoading(false));

    return () => controller.abort();
  }, [date, refreshToken]);

  const total = report?.total || 0;
  const severityCounts = report?.counts.severity || { critical: 0, warning: 0, info: 0 };
  const categoryCounts = report?.counts.category || { Crew: 0, Jobs: 0, Fleet: 0, Finance: 0 };
  const exceptionsByCategory = useMemo(() => {
    const grouped = new Map<ExceptionCategory, OperationalExceptionsReport["exceptions"]>();
    for (const category of categoryOrder) {
      grouped.set(category, []);
    }
    for (const exception of report?.exceptions || []) {
      grouped.get(exception.category)?.push(exception);
    }
    return grouped;
  }, [report]);

  return (
    <section className={compact ? "ops-exceptions-panel ops-card ops-exceptions-compact" : "ops-exceptions-panel ops-card"}>
      <details
        className="ops-exceptions-details"
        open={expanded}
        onToggle={(event) => {
          setExpanded((event.currentTarget as HTMLDetailsElement).open);
        }}
      >
        <summary className="ops-exceptions-summary">
          <div className="ops-exceptions-summary-copy">
            <div className="ops-exceptions-title-row">
              <div className="ops-section-title">Exceptions</div>
              <div className="ops-exceptions-counts">
                <span className="ops-exception-chip ops-exception-critical">Critical {severityCounts.critical}</span>
                <span className="ops-exception-chip ops-exception-warning">Warning {severityCounts.warning}</span>
                <span className="ops-exception-chip ops-exception-info">Info {severityCounts.info}</span>
              </div>
            </div>
            <div className="ops-exceptions-category-counts">
              {categoryOrder.map((category) => (
                <span key={category} className="ops-exception-chip ops-exception-category-chip">
                  {category} {categoryCounts[category]}
                </span>
              ))}
            </div>
            {!compact ? (
              <>
                <div className="ops-muted">
                  {loading
                    ? "Loading current operational exceptions…"
                    : error
                      ? error
                      : total > 0
                        ? `${total} exception${total === 1 ? "" : "s"} found for ${report?.date}.`
                        : `No operational exceptions found for ${report?.date}.`}
                </div>
                <div className="ops-table-note">
                  Data as of {report?.asOfLabel || "Unavailable"} · collapse to hide this panel.
                </div>
              </>
            ) : null}
          </div>
          <div className="ops-exceptions-summary-actions">
            <button
              type="button"
              className="ops-mini-link ops-exception-refresh"
              onClick={(event) => {
                event.preventDefault();
                event.stopPropagation();
                setRefreshToken((value) => value + 1);
              }}
              >
              Refresh
            </button>
            <button
              type="button"
              className="ops-mini-link ops-exception-view"
              onClick={(event) => {
                event.preventDefault();
                event.stopPropagation();
                setExpanded((value) => !value);
              }}
            >
              {expanded ? "Hide exceptions" : "View exceptions"}
            </button>
          </div>
        </summary>

        <div className="ops-exceptions-body">
          <div className={compact ? "ops-exceptions-category-grid ops-exceptions-category-grid-compact" : "ops-exceptions-category-grid"}>
            {categoryOrder.map((category) => (
              <div key={category} className="ops-exceptions-category-card">
                <div className="ops-exceptions-category-head">
                  <strong>{category}</strong>
                  <div className="ops-exceptions-category-head-right">
                    <span>{categoryCounts[category]}</span>
                    {categoryCounts[category] > 5 ? (
                      <button
                        type="button"
                        className="ops-mini-link ops-exception-category-toggle"
                        onClick={(event) => {
                          event.preventDefault();
                          event.stopPropagation();
                          setExpandedCategories((current) => {
                            const next = new Set(current);
                            if (next.has(category)) {
                              next.delete(category);
                            } else {
                              next.add(category);
                            }
                            return next;
                          });
                        }}
                      >
                        {expandedCategories.has(category) ? "Show less" : "Show all"}
                      </button>
                    ) : null}
                  </div>
                </div>
                <div className="ops-exceptions-list">
                  {(() => {
                    const items = exceptionsByCategory.get(category) || [];
                    if (!items.length) {
                      return <div className="ops-exceptions-empty-line">No {category} exceptions</div>;
                    }

                    const visible = expandedCategories.has(category) ? items : items.slice(0, 5);
                    return visible.map((exception) => (
                      <article key={exception.id} className={`ops-exception-item ${severityClass(exception.severity)}`}>
                        <div className="ops-exception-item-top">
                          <div>
                            <div className="ops-exception-item-title">{exception.title}</div>
                            <div className="ops-exception-item-entity">{exception.entityLabel}</div>
                          </div>
                          <span className={`ops-exception-chip ${severityClass(exception.severity)}`}>
                            {severityLabels[exception.severity]}
                          </span>
                        </div>
                        <div className="ops-exception-item-body">
                          <div>{exception.reason}</div>
                          <div className="ops-exception-item-meta">
                            <span>Source: {exception.source}</span>
                            <span>Timestamp: {exception.timestamp}</span>
                          </div>
                          {exception.href ? (
                            <a className="ops-mini-link ops-exception-link" href={exception.href}>
                              Open related record
                            </a>
                          ) : null}
                        </div>
                      </article>
                    ));
                  })()}
                </div>
                {categoryCounts[category] > 5 && !expandedCategories.has(category) ? (
                  <button
                    type="button"
                    className="ops-mini-link ops-exception-show-more"
                    onClick={(event) => {
                      event.preventDefault();
                      event.stopPropagation();
                      setExpandedCategories((current) => {
                        const next = new Set(current);
                        next.add(category);
                        return next;
                      });
                    }}
                  >
                    Show all {categoryCounts[category]}
                  </button>
                ) : null}
              </div>
            ))}
          </div>
          {error ? <div className="ops-exceptions-error">{error}</div> : null}
        </div>
      </details>
    </section>
  );
}
