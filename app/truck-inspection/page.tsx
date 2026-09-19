import { inspectionFont } from "@/lib/inspection-font";
import type { Metadata, Viewport } from "next";
import TruckInspectionApp from "@/components/TruckInspectionApp";
export const metadata: Metadata = { title: { absolute: "Waypoint · finish inspection" }, applicationName: "Waypoint · finish inspection", icons: { icon: { url: "/truck-inspection/convoy-gear-crown-v2-32.png", sizes: "32x32", type: "image/png" }, apple: { url: "/truck-inspection/convoy-gear-crown-v2-180.png", sizes: "180x180", type: "image/png" } }, manifest: null, appleWebApp: { capable: true, title: "Waypoint · finish inspection", statusBarStyle: "default" }, robots: { index: false, follow: false } };
export const viewport: Viewport = { width: "device-width", initialScale: 1, viewportFit: "cover", themeColor: "#242323" };
export default function Page() { return <div className={inspectionFont.variable}><TruckInspectionApp /></div>; }
