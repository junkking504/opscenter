import type { Metadata, Viewport } from "next";
import "./globals.css";
import "leaflet/dist/leaflet.css";
import "./ops-design-system.css";

export const metadata: Metadata = {
  title: {
    default: "OpsCenter | Junk King Louisiana",
    template: "%s | OpsCenter",
  },
  description: "Junk King Louisiana real-time operations command center",
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
