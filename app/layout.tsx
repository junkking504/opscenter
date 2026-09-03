import type { Metadata, Viewport } from "next";
import "leaflet/dist/leaflet.css";
import "./ops-styles.css";

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
  themeColor: "#f1f3f1",
  colorScheme: "light",
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
