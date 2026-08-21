import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export type JunkwareAppointmentNoteResult = {
  appointmentId: string;
  note: string;
  verifiedAt: string;
};

export function validJunkwareAppointmentNote(value: unknown): string {
  const note = String(value || "").trim();
  if (!note) throw new Error("Enter a note for the appointment.");
  if (note.length > 500) throw new Error("JunkWare appointment notes can be up to 500 characters.");
  return note;
}

export async function addJunkwareAppointmentNote(input: {
  appointmentId: string;
  note: string;
}): Promise<JunkwareAppointmentNoteResult> {
  const appointmentId = String(input.appointmentId || "").trim();
  const note = validJunkwareAppointmentNote(input.note);
  if (!/^\d{1,12}$/.test(appointmentId)) throw new Error("The JunkWare appointment ID is unavailable.");

  if (process.env.JUNKWARE_APPOINTMENT_NOTE_STUB === "1") {
    return { appointmentId, note, verifiedAt: new Date().toISOString() };
  }

  try {
    const { stdout } = await execFileAsync(process.execPath, [
      "--import",
      "tsx",
      path.join(process.cwd(), "scripts", "add-junkware-appointment-note.ts"),
      "--appointment",
      appointmentId,
      "--note-base64",
      Buffer.from(note, "utf8").toString("base64url"),
    ], {
      cwd: process.cwd(),
      encoding: "utf8",
      timeout: 120_000,
      maxBuffer: 1024 * 1024,
      env: { ...process.env },
    });
    const payload = JSON.parse(String(stdout || "").trim());
    if (!payload?.ok || payload?.mode !== "add-note" || String(payload?.appointmentId || "") !== appointmentId) {
      throw new Error("JunkWare did not verify the appointment note.");
    }
    return {
      appointmentId,
      note,
      verifiedAt: String(payload.verifiedAt || new Date().toISOString()),
    };
  } catch (error) {
    const detail = error && typeof error === "object" && "stderr" in error
      ? String(error.stderr || "").trim()
      : error instanceof Error ? error.message : "";
    const safeDetail = detail.split("\n")[0].slice(0, 300);
    throw new Error(safeDetail || "JunkWare could not save the appointment note.");
  }
}
