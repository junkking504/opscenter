import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "OpsCenter",
  description: "Local Junk King operations dashboard"
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
