import {
  readJobRouteAssignmentOverrides,
  readPendingJobRouteAssignments,
  saveJobRouteAssignment,
  withJunkwareAppointmentSyncLock,
  type JobRouteAssignment,
} from "../lib/job-route-assignments";
import { classifyJunkwareAssignmentFailure } from "../lib/junkware-assignment-failure";
import { syncJunkwareTruckAssignment } from "../lib/junkware-truck-assignment";

const maxAttempts = Math.max(1, Math.min(20, Number(process.env.JOB_ROUTE_RETRY_BATCH_SIZE || 5)));

function durationHours(entry: JobRouteAssignment): number {
  if (entry.appointmentStartMinutes === undefined || entry.appointmentEndMinutes === undefined) return 1;
  const duration = (entry.appointmentEndMinutes - entry.appointmentStartMinutes) / 60;
  return Number.isInteger(duration) && duration >= 1 && duration <= 12 ? duration : 1;
}

async function retry(entry: JobRouteAssignment): Promise<void> {
  const appointmentId = String(entry.appointmentId || "").trim();
  if (!appointmentId) return;

  await withJunkwareAppointmentSyncLock(appointmentId, async () => {
    // The operator may have moved the appointment again while this retry was
    // waiting. Never send an older truck decision after a newer one.
    const current = readJobRouteAssignmentOverrides(entry.date).get(entry.jobKey);
    if (!current || current.junkwareSyncStatus !== "pending" || current.updatedAt !== entry.updatedAt) return;

    try {
      const junkware = await syncJunkwareTruckAssignment({
        appointmentId,
        truck: current.truck,
        appointmentStartMinutes: current.appointmentStartMinutes,
        durationHours: durationHours(current),
      });
      const saved = saveJobRouteAssignment({
        ...current,
        expectedUpdatedAt: current.updatedAt,
        junkwareVerifiedAt: junkware.verifiedAt,
        junkwareSyncStatus: "verified",
        junkwareSyncError: "",
      });
      if (saved) {
        console.info("[job-route-retry] JunkWare verified", {
          date: current.date,
          jobKey: current.jobKey,
          appointmentId,
          truck: current.truck || "unassigned",
          changed: junkware.changed,
        });
      }
    } catch (error) {
      const detail = error instanceof Error ? error.message : "JunkWare could not verify the assignment.";
      const junkwareSyncStatus = classifyJunkwareAssignmentFailure(error);
      saveJobRouteAssignment({
        ...current,
        expectedUpdatedAt: current.updatedAt,
        junkwareSyncStatus,
        junkwareSyncError: detail,
      });
      console.warn(`[job-route-retry] ${junkwareSyncStatus === "manual_correction" ? "needs manual correction" : "verification still pending"}`, {
        date: current.date,
        jobKey: current.jobKey,
        appointmentId,
        truck: current.truck || "unassigned",
        error: detail,
      });
    }
  });
}

async function main(): Promise<void> {
  const pending = readPendingJobRouteAssignments().slice(0, maxAttempts);
  if (pending.length === 0) return;
  console.info(`[job-route-retry] retrying ${pending.length} pending assignment(s)`);
  for (const entry of pending) await retry(entry);
}

main().catch((error) => {
  console.error("[job-route-retry] fatal", error);
  process.exitCode = 1;
});
