import Link from "next/link";
import PageHeader from "@/components/PageHeader";
import { getQboSetupStatus } from "@/lib/qbo-status";

export const metadata = {
  title: "QBO Connection | OpsCenter",
  description: "Prepare the QuickBooks Online connection for OpsCenter.",
};

function statusLabel(ready: boolean) {
  return ready ? "Ready for setup" : "Missing configuration";
}

export default function QboPage() {
  const status = getQboSetupStatus();

  return (
    <div className="ops-dashboard">
      <PageHeader
        title="QBO Connection"
        subtitle="Prepare the QuickBooks Online app configuration, URLs, and support details before production authorization."
        date="2026-07-16"
        showDateSelector={false}
        showRefresh={false}
        status={statusLabel(status.ready)}
      />

      <div className="ops-card">
        <div className="ops-card-header compact">
          <div>
            <div className="ops-section-title">Connection overview</div>
            <div className="ops-muted">This page is public and designed for Intuit app review and internal setup.</div>
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
            <span>Accounting scope</span>
            <strong>{status.scope}</strong>
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
            <strong>{status.tokenStore.directory}</strong>
          </div>
        </div>

        <div className="ops-alert ops-alert-warning">
          <strong>Setup status:</strong>{" "}
          {status.ready ? "Environment variables are present." : `Missing: ${status.missingConfig.join(", ") || "None"}`}
        </div>

        <div className="ops-compact-links">
          <Link href="/integrations/qbo/status">Connection status</Link>
          <Link href="/integrations/qbo/disconnected">Disconnect confirmation</Link>
          <Link href="/legal/privacy">Privacy Policy</Link>
          <Link href="/legal/terms">Terms of Use</Link>
          <Link href="/support">Support</Link>
        </div>
      </div>
    </div>
  );
}
