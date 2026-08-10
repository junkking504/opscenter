import Link from "next/link";
import PageHeader from "@/components/PageHeader";
import { getQboSetupStatus } from "@/lib/qbo-status";

export const metadata = {
  title: "QBO Disconnected | OpsCenter",
  description: "Confirm the QuickBooks Online connection has been disconnected.",
};

export default function QboDisconnectedPage() {
  const status = getQboSetupStatus();

  return (
    <div className="ops-dashboard">
      <PageHeader
        title="QBO Disconnected"
        subtitle="Use this page to confirm revocation and review the local token storage design."
        date="2026-07-16"
        showDateSelector={false}
        showRefresh={false}
      />

      <div className="ops-card">
        <div className="ops-section-title">Disconnect Confirmation</div>
        <p className="ops-muted">
          If a live connection exists in the future, disconnecting should clear the local token store outside the Git repository and revoke
          access from the application side. No live QBO token has been provisioned in this phase.
        </p>

        <div className="ops-detail-grid">
          <div>
            <span>Token store path</span>
            <strong>{status.tokenStore.directory}</strong>
          </div>
          <div>
            <span>Stored token file</span>
            <strong>{status.tokenStore.file}</strong>
          </div>
          <div>
            <span>Current state</span>
            <strong>{status.tokenStore.exists ? "Connection data present" : "No stored QBO tokens"}</strong>
          </div>
          <div>
            <span>Support contact</span>
            <strong>{status.supportEmail || "Not configured"}</strong>
          </div>
        </div>

        <div className="ops-compact-links">
          <Link href="/integrations/qbo">Back to QBO Connection</Link>
          <Link href="/support">Support</Link>
        </div>
      </div>
    </div>
  );
}
