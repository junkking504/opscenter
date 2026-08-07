import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export async function junkwareJobCloseout(appointmentId: string, payload?: Record<string, unknown>) {
  if (!/^\d{1,12}$/.test(appointmentId)) throw new Error("The JunkWare appointment ID is unavailable.");
  const args = ["--import", "tsx", path.join(process.cwd(), "scripts", "sync-junkware-job-closeout.ts"), "--appointment", appointmentId, "--mode", payload ? "write" : "read"];
  if (payload) args.push("--payload-base64", Buffer.from(JSON.stringify(payload)).toString("base64url"));
  try {
    const { stdout } = await execFileAsync(process.execPath, args, {
      cwd: process.cwd(),
      encoding: "utf8",
      timeout: 180_000,
      maxBuffer: 2 * 1024 * 1024,
      env: { ...process.env },
    });
    const result = JSON.parse(String(stdout || "").trim());
    if (!result?.ok) throw new Error("JunkWare did not verify the closeout.");
    return result;
  } catch (error) {
    const detail = error && typeof error === "object" && "stderr" in error
      ? String(error.stderr || "").trim()
      : error instanceof Error ? error.message : "";
    throw new Error(detail.split("\n")[0].slice(0, 400) || "JunkWare could not verify the closeout.");
  }
}
