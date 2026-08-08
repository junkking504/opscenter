import { Suspense } from "react";
import OpsNav from "@/components/OpsNav";
import OperationsClock from "@/components/OperationsClock";
import JunkKingLogo from "@/components/JunkKingLogo";
import AddOnNotifications from "@/components/AddOnNotifications";
import { getOpsRuntime } from "@/lib/runtime";

export default function OpsShell({
  children,
  sessionEmail,
}: {
  children: React.ReactNode;
  sessionEmail?: string | null;
}) {
  const runtimeStatus = getOpsRuntime();
  const runtimeBadge = runtimeStatus === "VPS"
    ? {
        className: "is-vps",
        prefix: "View via",
        value: "VPS",
        label: "Current view is served from the snapshot stored on the remote VPS",
      }
    : runtimeStatus === "MAC_MINI_PREVIEW"
      ? {
          className: "is-preview",
          prefix: "Preview",
          value: "Mission Control",
          label: "Preview served by the Mission Control Mac Mini",
        }
      : runtimeStatus === "MISSION_CONTROL"
        ? {
            className: "is-mission-control",
            prefix: "Host",
            value: "Mission Control",
            label: "Served by the Mission Control Mac Mini",
          }
        : null;

  return (
    <div className="ops-app">
      <input id="ops-sidebar-toggle" className="ops-sidebar-toggle" type="checkbox" aria-hidden="true" />
      <label htmlFor="ops-sidebar-toggle" className="ops-sidebar-backdrop" aria-hidden="true" />
      <aside className="ops-sidebar">
        <div className="ops-brand">
          <JunkKingLogo className="ops-junk-king-logo" />
          <div className="ops-brand-product">
            <div className="ops-brand-title">OpsCenter</div>
            <div className="ops-brand-subtitle">Junk King | Louisiana</div>
          </div>
        </div>

        <Suspense fallback={<nav className="ops-nav" aria-hidden="true" />}>
          <OpsNav variant="sidebar" />
        </Suspense>

        <div className="ops-sidebar-footer">
          <div className="ops-sidebar-footer-top">
            <div className="ops-status-pill">
              <span className="ops-pulse" />
              Network online
            </div>
            <span className="ops-sidebar-footer-code">JKLA</span>
          </div>
          {sessionEmail ? <div className="ops-small-muted">Signed in as {sessionEmail}</div> : null}
          <a href="/api/auth/logout" className="ops-mini-link">
            Logout
          </a>
          <div className="ops-small-muted">Ready for live refresh</div>
        </div>
      </aside>

      <main className="ops-main">
        <div className="ops-main-frame">
          <div className="ops-mobile-brand" aria-label="Junk King OpsCenter">
            <JunkKingLogo className="ops-mobile-junk-king-logo" />
            <span>OpsCenter</span>
          </div>
          <header className="ops-topbar">
            <div className="ops-topbar-identity">
              <div className="ops-eyebrow">Junk King | Louisiana</div>
              <div className="ops-topbar-title-row">
                <h1>OpsCenter</h1>
              </div>
            </div>

            <div className="ops-topbar-right">
              <label htmlFor="ops-sidebar-toggle" className="ops-sidebar-toggle-button">
                Menu
              </label>
              <AddOnNotifications sessionEmail={sessionEmail} />
              <OperationsClock />
              <div className="ops-live-chip" aria-label="Live operations data connected">
                <span className="ops-pulse" />
                Live feed
              </div>
              {runtimeBadge ? (
                <div
                  className={`ops-runtime-status ${runtimeBadge.className}`}
                  aria-label={runtimeBadge.label}
                  title={runtimeBadge.label}
                >
                  <span>{runtimeBadge.prefix}</span>
                  <strong>{runtimeBadge.value}</strong>
                </div>
              ) : null}
            </div>
          </header>

          <section className="ops-content">{children}</section>
        </div>
      </main>

      <OpsNav variant="bottom" />
    </div>
  );
}
