import { inspectionFont } from "@/lib/inspection-font";
import type { Metadata, Viewport } from "next";
import TruckInspectionApp from "@/components/TruckInspectionApp";
export const metadata: Metadata = { title: { absolute: "Convoy" }, applicationName: "Convoy", icons: { icon: { url: "/truck-inspection/convoy-gear-crown-v1-32.png", sizes: "32x32", type: "image/png" }, apple: { url: "/truck-inspection/convoy-gear-crown-v1-180.png", sizes: "180x180", type: "image/png" } }, manifest: "/truck-inspection/manifest.webmanifest", appleWebApp: { capable: true, title: "Convoy", statusBarStyle: "default" }, robots: { index: false, follow: false } };
export const viewport: Viewport = { width: "device-width", initialScale: 1, viewportFit: "cover", themeColor: "#242323" };
export default function Page() { return <div className={inspectionFont.variable}><TruckInspectionApp /></div>; }
