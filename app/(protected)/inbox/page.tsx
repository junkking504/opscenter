import OperatingInbox from "@/components/OperatingInbox";
import { validOperatingDate } from "@/lib/platform/request-actor";
import { resolveKernelDatabaseConfig } from "@/lib/platform/persistence/config";
import "./inbox.css";

export const dynamic = "force-dynamic";

export default async function InboxPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const dateValue = Array.isArray(params.date) ? params.date[0] : params.date;
  const date = validOperatingDate(dateValue || null);
  const kernelDatabase = resolveKernelDatabaseConfig();

  return (
    <div className="ops-dashboard ops-inbox-page">
      <h1 className="ops-sr-only">Inbox</h1>
      <OperatingInbox
        date={date}
        enabled={kernelDatabase.status === "ready"}
        disabledReason={kernelDatabase.status === "ready" ? undefined : kernelDatabase.reason}
      />
    </div>
  );
}
