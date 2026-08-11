import Link from "next/link";
import PageHeader from "@/components/PageHeader";
import { getQboSetupStatus } from "@/lib/qbo-status";

export const metadata = {
  title: "QBO Connection | OpsCenter",
  description: "Prepare the QuickBooks Online connection for OpsCenter.",
};
export const dynamic = "force-dynamic";

function statusLabel(ready: boolean, connected: boolean) {
  if (connected) return "Connected";
  return ready ? "Ready to connect" : "Missing configuration";
}

export default function QboPage() {
  const status = getQboSetupStatus();

  return (
    <div className="ops-dashboard">
      <PageHeader
        title="QBO Connection"
        subtitle="Connect OpsCenter directly to QuickBooks Online without browser-session scraping."
        date="2026-07-16"
        showDateSelector={false}
        showRefresh={false}
        status={statusLabel(status.ready, status.connected)}
      />

      <div className="ops-card">
        <div className="ops-card-header compact">
          <div>
            <div className="ops-section-title">Connection Overview</div>
            <div className="ops-muted">OAuth tokens are encrypted at rest and remain on the Mission Control host.</div>
          </div>
          <Link href="/api/integrations/qbo/connect" className="ops-button">
            Connect with QuickBooks
          </Link>
        </div>

        <div className="ops-detail-grid">
          <div>
            <span>App name</span>
            <strong>{status.appName}</strong>
          </div>
          <div>
            <span>Purpose</span>
            <strong>{status.appPurpose}</strong>
          </div>
          <div>
            <span>Distribution</span>
            <strong>{status.distribution}</strong>
          </div>
          <div>
            <span>API scopes</span>
            <strong>{status.scopes.join(" + ")}</strong>
          </div>
          <div>
            <span>Host domain</span>
            <strong>{status.publicOrigin}</strong>
          </div>
          <div>
            <span>Redirect URI</span>
            <strong>{status.redirectUri}</strong>
          </div>
          <div>
            <span>Support email</span>
            <strong>{status.supportEmail || "Not configured"}</strong>
          </div>
          <div>
            <span>Token storage</span>
            <strong>Encrypted local store</strong>
          </div>
        </div>

        <div className="ops-alert ops-alert-warning">
          <strong>Setup status:</strong>{" "}
          {status.connected
            ? "QuickBooks is connected and scheduled Accounting API collection is available."
            : status.ready
              ? "Configuration is present. Complete the one-time QuickBooks authorization."
              : `Missing: ${status.missingConfig.join(", ") || "None"}`}
        </div>

        <div className="ops-compact-links">
          <Link href="/integrations/qbo/status">Connection status</Link>
          <Link href="/legal/privacy">Privacy Policy</Link>
          <Link href="/legal/terms">Terms of Use</Link>
          <Link href="/support">Support</Link>
        </div>
      </div>
    </div>
  );
}
