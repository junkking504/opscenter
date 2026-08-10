export type OpsRuntime = "LIVE" | "VPS" | "MISSION_CONTROL" | "MAC_MINI_PREVIEW";

export function getOpsRuntime(): OpsRuntime {
  const configuredRuntime = process.env["OPSCENTER_RUNTIME"]?.trim().toUpperCase();
  if (
    configuredRuntime === "VPS"
    || configuredRuntime === "MISSION_CONTROL"
    || configuredRuntime === "MAC_MINI_PREVIEW"
  ) {
    return configuredRuntime;
  }
  return "LIVE";
}
