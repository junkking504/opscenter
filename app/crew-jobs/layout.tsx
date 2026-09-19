import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: { absolute: 'Waypoint' },
  applicationName: 'Waypoint',
  description: 'Junk King company-phone jobs and closeout.',
  manifest: '/crew-jobs/manifest.webmanifest',
  icons: { icon: '/crew-jobs/icon.png', apple: '/crew-jobs/icon.png' },
  appleWebApp: { capable: true, title: 'Waypoint', statusBarStyle: 'default' },
  robots: { index: false, follow: false },
};

export default function WaypointLayout({ children }: { children: React.ReactNode }) {
  return children;
}
