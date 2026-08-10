export function jobRouteAssignmentKey(job: {
  appointmentId?: string;
  jkNumber?: string;
  customerName?: string;
  appointmentTime?: string;
  address?: string;
}): string {
  const appointmentId = String(job.appointmentId || "").trim();
  if (appointmentId) return `appt:${appointmentId}`;

  const jkNumber = String(job.jkNumber || "").trim().toLowerCase();
  if (jkNumber && jkNumber !== "—") return `job:${jkNumber}`;

  return [job.customerName, job.appointmentTime, job.address]
    .map((value) => String(value || "").trim().toLowerCase())
    .join("|");
}
