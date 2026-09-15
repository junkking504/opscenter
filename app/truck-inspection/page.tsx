import type { Metadata, Viewport } from "next";
import TruckInspectionApp from "@/components/TruckInspectionApp";
export const metadata: Metadata = { title: "Truck Inspection", manifest: "/truck-inspection/manifest.webmanifest", appleWebApp: { capable: true, title: "Truck Check", statusBarStyle: "default" }, robots: { index: false, follow: false } };
export const viewport: Viewport = { width: "device-width", initialScale: 1, viewportFit: "cover", themeColor: "#be0b30" };
export default function Page() { return <TruckInspectionApp />; }
