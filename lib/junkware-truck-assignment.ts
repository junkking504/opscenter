import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export type JunkwareTruckAssignmentResult = {
  appointmentId: string;
  previousTruck: string;
  truck: string;
  changed: boolean;
  previousAppointmentStartMinutes?: number;
  appointmentStartMinutes?: number;
  verifiedAt: string;
};

export async function syncJunkwareTruckAssignment(input: {
  appointmentId: string;
  truck: string;
  appointmentStartMinutes?: number;
  durationHours?: number;
}): Promise<JunkwareTruckAssignmentResult> {
  const appointmentId = String(input.appointmentId || "").trim();
  const truck = String(input.truck || "").trim();
  if (!/^\d{1,12}$/.test(appointmentId)) throw new Error("The JunkWare appointment ID is unavailable.");
  if (truck && !/^Truck [1-9][0-9]?$/.test(truck)) throw new Error("That truck is not available in JunkWare.");
  const appointmentStartMinutes = Number.isInteger(input.appointmentStartMinutes)
    ? Number(input.appointmentStartMinutes)
    : undefined;
  const durationHours = Number.isInteger(input.durationHours) ? Number(input.durationHours) : 1;
  if (appointmentStartMinutes !== undefined && (
    appointmentStartMinutes < 0
    || appointmentStartMinutes >= 24 * 60
    || appointmentStartMinutes % 60 !== 0
  )) throw new Error("That appointment time is not a valid JunkWare time slot.");
  if (durationHours < 1 || durationHours > 12) throw new Error("That appointment duration is not valid in JunkWare.");

  if (process.env.JUNKWARE_ASSIGNMENT_STUB === "1") {
    return {
      appointmentId,
      previousTruck: "",
      truck,
      changed: true,
      ...(appointmentStartMinutes !== undefined ? { appointmentStartMinutes } : {}),
      verifiedAt: new Date().toISOString(),
    };
  }

  const script = path.join(process.cwd(), "scripts", "sync-junkware-truck-assignment.ts");
  try {
    const args = [
      "--import",
      "tsx",
      script,
      "--appointment",
      appointmentId,
      "--truck",
      truck || "unassigned",
    ];
    if (appointmentStartMinutes !== undefined) {
      args.push("--start-minutes", String(appointmentStartMinutes), "--duration-hours", String(durationHours));
    }
    const { stdout } = await execFileAsync(process.execPath, args, {
      cwd: process.cwd(),
      encoding: "utf8",
      timeout: 120_000,
      maxBuffer: 1024 * 1024,
      env: { ...process.env },
    });
    const payload = JSON.parse(String(stdout || "").trim());
    if (
      !payload?.ok
      || payload?.mode !== "assign"
      || String(payload?.truck || "") !== truck
      || (appointmentStartMinutes !== undefined && Number(payload?.appointmentStartMinutes) !== appointmentStartMinutes)
    ) {
      throw new Error("JunkWare did not verify the requested appointment change.");
    }
    return {
      appointmentId,
      previousTruck: String(payload.previousTruck || ""),
      truck,
      changed: Boolean(payload.changed),
      ...(Number.isInteger(payload.previousAppointmentStartMinutes)
        ? { previousAppointmentStartMinutes: Number(payload.previousAppointmentStartMinutes) }
        : {}),
      ...(appointmentStartMinutes !== undefined ? { appointmentStartMinutes } : {}),
      verifiedAt: String(payload.verifiedAt || new Date().toISOString()),
    };
  } catch (error) {
    const detail = error && typeof error === "object" && "stderr" in error
      ? String(error.stderr || "").trim()
      : error instanceof Error ? error.message : "";
    const safeDetail = detail.split("\n")[0].slice(0, 300);
    throw new Error(safeDetail || "JunkWare could not verify the appointment change.");
  }
}
