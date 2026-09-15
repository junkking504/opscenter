import { inspectionFont } from "@/lib/inspection-font";
import type { Metadata, Viewport } from "next";
import TruckInspectionApp from "@/components/TruckInspectionApp";
export const metadata: Metadata = { title: "Five Point Inspection", applicationName: "Five Point Inspection", icons: { icon: { url: "/truck-inspection/icon.svg?v=junk-king-crown-3", type: "image/svg+xml" }, apple: { url: "/truck-inspection/junk-king-crown-180.png", sizes: "180x180", type: "image/png" } }, manifest: "/truck-inspection/manifest.webmanifest", appleWebApp: { capable: true, title: "Five Point Inspection", statusBarStyle: "default" }, robots: { index: false, follow: false } };
export const viewport: Viewport = { width: "device-width", initialScale: 1, viewportFit: "cover", themeColor: "#242323" };
export default function Page() { return <div className={inspectionFont.variable}><TruckInspectionApp /></div>; }
