import { inspectionFont } from "@/lib/inspection-font";
import type { Metadata, Viewport } from "next";
import { headers } from "next/headers";
import { usesWaypointInspection } from "@/lib/inspection-entry";
import WaypointApp from "@/components/WaypointApp";
import ConvoyApp from "@/components/ConvoyApp";
import { metadata as waypointMetadata } from "../crew-jobs/layout";

export async function generateMetadata(): Promise<Metadata> {
  if (usesWaypointInspection(await headers())) return waypointMetadata;
  return {
    title: { absolute: "Convoy" }, applicationName: "Convoy",
    description: "Junk King five-point truck inspections.",
    manifest: "/truck-inspection/manifest.webmanifest",
    icons: {
      icon: { url: "/truck-inspection/convoy-gear-crown-v2-32.png", sizes: "32x32", type: "image/png" },
      shortcut: "/truck-inspection/convoy-gear-crown-v2-32.png",
      apple: { url: "/truck-inspection/convoy-gear-crown-v2-180.png", sizes: "180x180", type: "image/png" },
    },
    appleWebApp: { capable: true, title: "Convoy", statusBarStyle: "default" },
    robots: { index: false, follow: false },
  };
}

export const viewport: Viewport = { width: "device-width", initialScale: 1, viewportFit: "cover", themeColor: "#171717" };
export default async function Page() {
  const waypoint = usesWaypointInspection(await headers());
  return <div className={inspectionFont.variable}>{waypoint ? <WaypointApp initialView="inspections" /> : <ConvoyApp />}</div>;
}
