import Link from "next/link";
import PageHeader from "@/components/PageHeader";
import { getQboSetupStatus } from "@/lib/qbo-status";

export const metadata = {
  title: "QBO Connection Status | OpsCenter",
  description: "Review the current QuickBooks Online connection setup status.",
};
export const dynamic = "force-dynamic";

export default function QboStatusPage() {
  const status = getQboSetupStatus();

  return (
    <div className="ops-dashboard">
      <PageHeader
        title="QBO Connection Status"
        subtitle="Live OAuth configuration and encrypted token status for QuickBooks Online collection."
        date="2026-08-15"
        showDateSelector={false}
        showRefresh={false}
        status={status.connected ? "Connected" : status.ready ? "Ready to connect" : "Setup incomplete"}
      />

      <div className="ops-card">
        <div className="ops-detail-grid">
          <div>
            <span>Status</span>
            <strong>{status.connected ? "Connected" : status.ready ? "Ready for authorization" : "Missing configuration"}</strong>
          </div>
          <div>
            <span>Environment</span>
            <strong>{status.environment}</strong>
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
            <span>Expected company</span>
            <strong>{status.expectedCompanyName || "Confirm after authorization"}</strong>
          </div>
          <div>
            <span>Token store</span>
            <strong>{status.tokenStore.file}</strong>
          </div>
          <div>
            <span>Token store writable</span>
            <strong>{status.tokenStore.writable ? "Yes" : "No"}</strong>
          </div>
          <div>
            <span>Token encryption</span>
            <strong>{status.tokenStore.encrypted ? "AES-256-GCM" : "Awaiting authorization"}</strong>
          </div>
          <div>
            <span>Granted scopes</span>
            <strong>{status.tokenStore.masked.scope || status.scopes.join(" + ")}</strong>
          </div>
          <div>
            <span>Access token expires</span>
            <strong>{status.tokenStore.masked.expiresAt || "Not connected"}</strong>
          </div>
          <div>
            <span>OpsCenter card payments</span>
            <strong>{status.payments.canCharge ? "Ready" : status.payments.enabled ? "Setup incomplete" : "Disabled"}</strong>
          </div>
          <div>
            <span>Payments environment</span>
            <strong>{status.payments.environment}{status.payments.environment === "production" && !status.payments.liveChargesAllowed ? " · live charges locked" : ""}</strong>
          </div>
        </div>

        <div className="ops-muted" style={{ marginTop: 16 }}>
          {status.missingConfig.length ? `Missing configuration: ${status.missingConfig.join(", ")}` : "All required setup inputs are present."}
        </div>

        {status.payments.blockers.length ? <div className="ops-alert ops-alert-warning">
          <strong>Payments setup:</strong> {status.payments.blockers.join(" ")}
        </div> : null}

        <div className="ops-compact-links">
          <Link href="/integrations/qbo">Back to QBO Connection</Link>
          <Link href="/api/integrations/qbo/status">JSON status endpoint</Link>
        </div>
      </div>
    </div>
  );
}
