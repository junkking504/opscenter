export type OpsRuntime = "LIVE" | "VPS";

export function getOpsRuntime(): OpsRuntime {
  return process.env["OPSCENTER_RUNTIME"]?.trim().toUpperCase() === "VPS" ? "VPS" : "LIVE";
}
