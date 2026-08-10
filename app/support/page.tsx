import Link from "next/link";
import PageHeader from "@/components/PageHeader";
import { getQboSetupStatus } from "@/lib/qbo-status";

export const metadata = {
  title: "Support | OpsCenter",
  description: "Support and contact information for OpsCenter.",
};

export default function SupportPage() {
  const status = getQboSetupStatus();

  return (
    <div className="ops-dashboard">
      <PageHeader
        title="Support / Contact"
        subtitle="Use this page to identify the contact path for OpsCenter and QBO setup."
        date="2026-07-16"
        showDateSelector={false}
        showRefresh={false}
      />

      <div className="ops-card">
        <div className="ops-detail-grid">
          <div>
            <span>Support email</span>
            <strong>{status.supportEmail || "Not configured yet"}</strong>
          </div>
          <div>
            <span>Contact note</span>
            <strong>
              {status.supportEmail
                ? "Use this address for app review and connection help."
                : "Provide QBO_SUPPORT_EMAIL in the environment before production review."}
            </strong>
          </div>
        </div>

        <div className="ops-compact-links">
          <Link href="/integrations/qbo">QBO Connection</Link>
          <Link href="/legal/privacy">Privacy Policy</Link>
          <Link href="/legal/terms">Terms of Use</Link>
        </div>
      </div>
    </div>
  );
}
