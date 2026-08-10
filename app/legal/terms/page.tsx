import PageHeader from "@/components/PageHeader";
import type { ReactNode } from "react";

export const metadata = {
  title: "Terms of Use | OpsCenter",
  description: "Terms of use for the internal OpsCenter reporting tool.",
};

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="ops-card">
      <div className="ops-section-title">{title}</div>
      <div className="ops-legal-copy">{children}</div>
    </section>
  );
}

export default function TermsPage() {
  return (
    <div className="ops-dashboard">
      <PageHeader
        title="Terms of Use / EULA"
        subtitle="OpsCenter is an internal business tool for operations and financial reporting."
        date="2026-07-16"
        showDateSelector={false}
        showRefresh={false}
      />

      <Section title="Internal use only">
        <p>
          OpsCenter is provided for internal business use by the operator of the Junk King businesses that use this installation. It is not a
          public consumer service and is not intended for resale or third-party customer access.
        </p>
      </Section>

      <Section title="Data usage">
        <p>
          The application uses internal accounting and operations data solely to produce reporting, reconciliation, payroll support, and
          operational views.
        </p>
      </Section>

      <Section title="Availability and responsibility">
        <p>
          The application is provided on an as-available basis. Operational decisions remain the responsibility of the business owner and
          authorized users.
        </p>
      </Section>

      <Section title="Revocation">
        <p>
          QuickBooks Online access may be revoked through the disconnect flow or by revoking the connected Intuit app in the Intuit developer
          console. Local token storage should be cleared when access is revoked.
        </p>
      </Section>
    </div>
  );
}
