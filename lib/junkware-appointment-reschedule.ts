import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export type JunkwareAppointmentRescheduleResult = {
  appointmentId: string;
  previousDate: string;
  previousAppointmentStartMinutes: number;
  date: string;
  appointmentStartMinutes: number;
  changed: boolean;
  verifiedAt: string;
};

export async function rescheduleJunkwareAppointment(input: {
  appointmentId: string;
  date: string;
  appointmentStartMinutes: number;
  expectedDate: string;
  expectedAppointmentStartMinutes: number;
}): Promise<JunkwareAppointmentRescheduleResult> {
  const appointmentId = String(input.appointmentId || "").trim();
  const date = String(input.date || "").trim();
  const expectedDate = String(input.expectedDate || "").trim();
  const appointmentStartMinutes = Number(input.appointmentStartMinutes);
  const expectedAppointmentStartMinutes = Number(input.expectedAppointmentStartMinutes);
  if (!/^\d{1,12}$/.test(appointmentId)) throw new Error("The JunkWare appointment ID is unavailable.");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{4}-\d{2}-\d{2}$/.test(expectedDate)) throw new Error("Choose a valid appointment date.");
  for (const minutes of [appointmentStartMinutes, expectedAppointmentStartMinutes]) {
    if (!Number.isInteger(minutes) || minutes < 0 || minutes >= 24 * 60 || minutes % 60 !== 0) {
      throw new Error("Choose a valid hourly appointment start time.");
    }
  }

  if (process.env.JUNKWARE_APPOINTMENT_RESCHEDULE_STUB === "1") {
    return {
      appointmentId,
      previousDate: expectedDate,
      previousAppointmentStartMinutes: expectedAppointmentStartMinutes,
      date,
      appointmentStartMinutes,
      changed: expectedDate !== date || expectedAppointmentStartMinutes !== appointmentStartMinutes,
      verifiedAt: new Date().toISOString(),
    };
  }

  const script = path.join(process.cwd(), "scripts", "reschedule-junkware-appointment.ts");
  try {
    const { stdout } = await execFileAsync(process.execPath, [
      "--import", "tsx", script,
      "--appointment", appointmentId,
      "--date", date,
      "--start-minutes", String(appointmentStartMinutes),
      "--expected-date", expectedDate,
      "--expected-start-minutes", String(expectedAppointmentStartMinutes),
    ], {
      cwd: process.cwd(),
      encoding: "utf8",
      timeout: 120_000,
      maxBuffer: 1024 * 1024,
      env: { ...process.env },
    });
    const payload = JSON.parse(String(stdout || "").trim());
    if (
      !payload?.ok
      || payload?.mode !== "reschedule"
      || String(payload?.appointmentId || "") !== appointmentId
      || String(payload?.previousDate || "") !== expectedDate
      || Number(payload?.previousAppointmentStartMinutes) !== expectedAppointmentStartMinutes
      || String(payload?.date || "") !== date
      || Number(payload?.appointmentStartMinutes) !== appointmentStartMinutes
    ) {
      throw new Error("JunkWare did not verify the requested reschedule.");
    }
    return {
      appointmentId,
      previousDate: String(payload.previousDate),
      previousAppointmentStartMinutes: Number(payload.previousAppointmentStartMinutes),
      date,
      appointmentStartMinutes,
      changed: Boolean(payload.changed),
      verifiedAt: String(payload.verifiedAt || new Date().toISOString()),
    };
  } catch (error) {
    const detail = error && typeof error === "object" && "stderr" in error
      ? String(error.stderr || "").trim()
      : error instanceof Error ? error.message : "";
    throw new Error(detail.split("\n")[0].slice(0, 300) || "JunkWare could not verify the appointment reschedule.");
  }
}
