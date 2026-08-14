import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export type JunkwareAppointmentCancellationResult = {
  appointmentId: string;
  previousStatus: string;
  status: "Canceled";
  changed: boolean;
  verifiedAt: string;
};

export async function cancelJunkwareAppointment(appointmentIdValue: string): Promise<JunkwareAppointmentCancellationResult> {
  const appointmentId = String(appointmentIdValue || "").trim();
  if (!/^\d{1,12}$/.test(appointmentId)) throw new Error("The JunkWare appointment ID is unavailable.");

  if (process.env.JUNKWARE_APPOINTMENT_CANCELLATION_STUB === "1") {
    return {
      appointmentId,
      previousStatus: "Confirmed",
      status: "Canceled",
      changed: true,
      verifiedAt: new Date().toISOString(),
    };
  }

  try {
    const { stdout } = await execFileAsync(process.execPath, [
      "--import",
      "tsx",
      path.join(process.cwd(), "scripts", "cancel-junkware-appointment.ts"),
      "--appointment",
      appointmentId,
    ], {
      cwd: process.cwd(),
      encoding: "utf8",
      timeout: 120_000,
      maxBuffer: 1024 * 1024,
      env: { ...process.env },
    });
    const payload = JSON.parse(String(stdout || "").trim());
    if (!payload?.ok || payload?.mode !== "cancel" || String(payload?.status || "") !== "Canceled") {
      throw new Error("JunkWare did not verify the appointment cancellation.");
    }
    return {
      appointmentId,
      previousStatus: String(payload.previousStatus || ""),
      status: "Canceled",
      changed: Boolean(payload.changed),
      verifiedAt: String(payload.verifiedAt || new Date().toISOString()),
    };
  } catch (error) {
    const detail = error && typeof error === "object" && "stderr" in error
      ? String(error.stderr || "").trim()
      : error instanceof Error ? error.message : "";
    const safeDetail = detail.split("\n")[0].slice(0, 300);
    throw new Error(safeDetail || "JunkWare could not verify the appointment cancellation.");
  }
}
