import { inspectionFont } from "@/lib/inspection-font";
import type { Viewport } from "next";
import { headers } from "next/headers";
import { CREW_JOBS_ORIGIN } from "@/lib/crew-phone";
import WaypointApp from "@/components/WaypointApp";
export { metadata } from "../crew-jobs/layout";

export const viewport: Viewport = { width: "device-width", initialScale: 1, viewportFit: "cover", themeColor: "#171717" };
export default async function Page() {
  const requestHeaders = await headers();
  const host = (requestHeaders.get("x-forwarded-host") || requestHeaders.get("host") || "").split(":")[0].toLowerCase();
  const isWebhookOrigin = host === (process.env.OPS_SMS_WEBHOOK_HOSTNAME || "hooks.junk-king.app").trim().toLowerCase();
  return <div className={inspectionFont.variable}><WaypointApp initialView="inspections" jobsHref={isWebhookOrigin ? `${CREW_JOBS_ORIGIN}/crew-jobs` : undefined} /></div>;
}
