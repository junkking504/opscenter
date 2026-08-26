import PageRefreshButton from "@/components/PageRefreshButton";
import { getDataHealthReport, type DataHealthLevel } from "@/lib/data-health";
import styles from "./DataHealth.module.css";

const levelClass: Record<DataHealthLevel, string> = {
  green: "ops-health-green",
  yellow: "ops-health-yellow",
  red: "ops-health-red",
};

function formatAge(minutes: number | null): string {
  if (minutes == null || Number.isNaN(minutes)) return "Unavailable";
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${Math.round(minutes)} min ago`;
  const hours = Math.floor(minutes / 60);
  const mins = Math.round(minutes % 60);
  return mins > 0 ? `${hours}h ${mins}m ago` : `${hours}h ago`;
}

type DataHealthProps = {
  compact?: boolean;
  strip?: boolean;
};

function shortTimestamp(value: string): string {
  if (!value || value === "Unavailable") return "Unavailable";
  return value.replace("T", " ").replace(/:\d{2}\.\d{3}Z$/, "Z").replace(/:\d{2}Z$/, "Z");
}

export default function DataHealth({ compact = false, strip = false }: DataHealthProps) {
  const report = getDataHealthReport();
  const overallLevel: DataHealthLevel =
    report.overall === "Healthy" ? "green" : report.overall === "Partial" ? "yellow" : "red";

  return (
    <section className={`ops-data-health${compact ? " ops-data-health-compact" : ""}${strip ? ` ops-data-health-strip ${styles.strip}` : ""}`}>
      <div className="ops-data-health-top">
        <div className={`ops-health-overall ${levelClass[overallLevel]}`}>
          {report.overall}
        </div>
        <div className="ops-data-health-asof">Data as of {shortTimestamp(report.asOfLabel)}</div>
        <div className="ops-data-health-actions">
          <PageRefreshButton label={compact ? "Refresh" : "Refresh"} />
        </div>
      </div>

      <div className="ops-data-health-source-strip">
        {Object.values(report.sources).map((source) => (
          <div key={source.key} className={`ops-data-health-source-chip ops-data-health-source-chip-${source.status}`}>
            <span className={`ops-health-dot ${levelClass[source.status]}`} />
            <span className="ops-data-health-source-name">{source.label}</span>
            <span className="ops-data-health-source-state">{source.stateLabel}</span>
          </div>
        ))}
      </div>

      <details className="ops-data-health-details">
        <summary>{compact ? "View details" : "Details"}</summary>
        <div className="ops-data-health-details-grid">
          <div className="ops-data-health-details-card">
            <span>JunkWare</span>
            <ul>
              <li>Last successful: {report.sources.junkware.lastSuccessfulAtLabel}</li>
              <li>Age: {formatAge(report.sources.junkware.ageMinutes)}</li>
              <li>{report.sources.junkware.details}</li>
            </ul>
          </div>
          <div className="ops-data-health-details-card">
            <span>Linxup</span>
            <ul>
              <li>Last successful: {report.sources.linxup.lastSuccessfulAtLabel}</li>
              <li>Age: {formatAge(report.sources.linxup.ageMinutes)}</li>
              <li>{report.sources.linxup.details}</li>
            </ul>
          </div>
          <div className="ops-data-health-details-card">
            <span>QBO</span>
            <ul>
              <li>{report.sources.qbo.stateLabel}</li>
              <li>Last successful: {report.sources.qbo.lastSuccessfulAtLabel}</li>
              <li>{report.sources.qbo.details}</li>
            </ul>
          </div>
          <div className="ops-data-health-details-card ops-data-health-details-wide">
            <span>Operational notes</span>
            <ul>
              <li>Missing files: {report.missingFiles.length ? report.missingFiles.join(", ") : "None"}</li>
              <li>Stale inputs: {report.staleInputs.length ? report.staleInputs.join(", ") : "None"}</li>
              <li>Fallback values: {report.fallbackValues.length ? report.fallbackValues.join(", ") : "None"}</li>
              <li>Recent collection errors: {report.recentErrors.length ? report.recentErrors.join(", ") : "None"}</li>
            </ul>
          </div>
        </div>
      </details>
    </section>
  );
}
