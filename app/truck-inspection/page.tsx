import { inspectionFont } from "@/lib/inspection-font";
import type { Metadata, Viewport } from "next";
import TruckInspectionApp from "@/components/TruckInspectionApp";
export const metadata: Metadata = { title: { absolute: "Convoy" }, applicationName: "Convoy", icons: { icon: { url: "/truck-inspection/icon.svg?v=gear-wrench-clean-4", type: "image/svg+xml" }, apple: { url: "/truck-inspection/gear-wrench-clean-180.png", sizes: "180x180", type: "image/png" } }, manifest: "/truck-inspection/manifest.webmanifest", appleWebApp: { capable: true, title: "Convoy", statusBarStyle: "default" }, robots: { index: false, follow: false } };
export const viewport: Viewport = { width: "device-width", initialScale: 1, viewportFit: "cover", themeColor: "#242323" };
export default function Page() { return <div className={inspectionFont.variable}><TruckInspectionApp /></div>; }
