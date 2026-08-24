import "./appointment-search.css";
import AppointmentSearchPanel from "@/components/AppointmentSearchPanel";
import PageHeader from "@/components/PageHeader";

export const dynamic = "force-dynamic";

export default function AppointmentSearchPage() {
  const date = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Chicago",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());

  return (
    <div className="ops-dashboard ops-appointment-search-page">
      <PageHeader
        title="Appointment Search"
        subtitle="Find any JunkWare appointment across every franchise by JK #, customer, date range, or status"
        date={date}
        showDateSelector={false}
        showRefresh={false}
      />
      <AppointmentSearchPanel />
    </div>
  );
}
