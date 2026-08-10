import type { Metadata, Viewport } from "next";
import "./globals.css";
import "leaflet/dist/leaflet.css";
import "./ops-design-system.css";
import "./dashboard-v2.css";
import "./ops-redesign.css";

export const metadata: Metadata = {
  title: {
    default: "OpsCenter | Junk King | Louisiana",
    template: "%s | OpsCenter",
  },
  description: "OpsCenter for Junk King | Louisiana",
  applicationName: "OpsCenter",
  appleWebApp: {
    capable: true,
    title: "OpsCenter",
    statusBarStyle: "black-translucent",
  },
};

export const viewport: Viewport = {
  themeColor: "#07090d",
  colorScheme: "dark",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
