import type { Metadata, Viewport } from "next";
import PwaRegistration from "@/components/PwaRegistration";
import "leaflet/dist/leaflet.css";
import "./ops-styles.css";

export const metadata: Metadata = {
  title: {
    default: "OpsCenter | Junk King | Louisiana",
    template: "%s | OpsCenter",
  },
  description: "OpsCenter for Junk King | Louisiana",
  applicationName: "OpsCenter",
  manifest: "/manifest.webmanifest",
  icons: {
    icon: [
      { url: "/icons/opscenter-192.png", sizes: "192x192", type: "image/png" },
      { url: "/icons/opscenter-512.png", sizes: "512x512", type: "image/png" },
    ],
    apple: [{ url: "/icons/opscenter-180.png", sizes: "180x180", type: "image/png" }],
  },
  appleWebApp: {
    capable: true,
    title: "OpsCenter",
    statusBarStyle: "black-translucent",
  },
};

export const viewport: Viewport = {
  themeColor: "#07090d",
  colorScheme: "dark",
  viewportFit: "cover",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>
        <PwaRegistration />
        {children}
      </body>
    </html>
  );
}
