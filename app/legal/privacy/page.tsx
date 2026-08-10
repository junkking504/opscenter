import PageHeader from "@/components/PageHeader";
import type { ReactNode } from "react";

export const metadata = {
  title: "Privacy Policy | OpsCenter",
  description: "Privacy policy for OpsCenter QBO access and internal reporting.",
};

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="ops-card">
      <div className="ops-section-title">{title}</div>
      <div className="ops-legal-copy">{children}</div>
    </section>
  );
}

export default function PrivacyPage() {
  return (
    <div className="ops-dashboard">
      <PageHeader
        title="Privacy Policy"
        subtitle="This policy describes how OpsCenter uses QuickBooks Online data for internal reporting."
        date="2026-07-16"
        showDateSelector={false}
        showRefresh={false}
      />

      <Section title="What we access">
        <p>
          OpsCenter is an internal operations dashboard. When QuickBooks Online is connected, it accesses accounting data needed to produce
          internal reporting, daily finance summaries, and reconciliation views for the user&apos;s Junk King businesses.
        </p>
        <p>
          The data typically includes sales receipts, invoice totals, payment totals, tip amounts, invoice balances, and other accounting
          records required for reporting.
        </p>
      </Section>

      <Section title="Why we access it">
        <p>
          The data is used only to calculate and display internal finance, operations, payroll-support, and reconciliation information inside
          OpsCenter.
        </p>
      </Section>

      <Section title="Where data is stored">
        <p>
          QuickBooks-derived daily artifacts are stored on the Mac host that runs OpsCenter. Token storage is designed to live outside the Git
          repository in a permission-restricted local directory. This phase does not assert encryption beyond host-level permissions unless
          explicitly enabled later.
        </p>
      </Section>

      <Section title="Retention and revocation">
        <p>
          Data is retained only as needed for internal reporting and historical reconciliation. Access can be revoked by disconnecting the
          QuickBooks Online integration, which clears local stored tokens when the disconnect flow is executed.
        </p>
      </Section>

      <Section title="Security practices">
        <p>
          OpsCenter keeps QBO credentials server-side, does not expose them to the browser, and avoids logging token values. The token store
          is intended to use atomic writes and restricted file permissions on the host.
        </p>
      </Section>
    </div>
  );
}
