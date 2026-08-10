import PageHeader from "@/components/PageHeader";
import OperatingInbox from "@/components/OperatingInbox";
import { availableDates } from "@/lib/opsData";
import { validOperatingDate } from "@/lib/platform/request-actor";

export const dynamic = "force-dynamic";

export default async function InboxPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const dateValue = Array.isArray(params.date) ? params.date[0] : params.date;
  const date = validOperatingDate(dateValue || null);

  return (
    <div className="ops-dashboard ops-inbox-page">
      <PageHeader
        title="Operating Inbox"
        subtitle="Every important signal becomes owned work, a controlled action, and a verifiable outcome."
        date={date}
        dates={availableDates()}
        showRefresh={false}
        status="Durable work queue"
      />
      <OperatingInbox date={date} />
    </div>
  );
}
