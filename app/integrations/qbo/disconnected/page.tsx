import Link from "next/link";
import PageHeader from "@/components/PageHeader";

export const metadata = {
  title: "QBO Disconnected | OpsCenter",
  description: "Confirm the QuickBooks Online connection has been disconnected.",
};

export default function QboDisconnectedPage() {
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
          OpsCenter has received the disconnect request. An authorized operator can reconnect from the protected QBO status page.
        </p>

        <div className="ops-compact-links">
          <Link href="/integrations/qbo">Back to QBO Connection</Link>
          <Link href="/support">Support</Link>
        </div>
      </div>
    </div>
  );
}
