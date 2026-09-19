import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: { absolute: 'Waypoint' },
  applicationName: 'Waypoint',
  description: 'Junk King company-phone jobs, closeout and truck inspections.',
  manifest: '/crew-jobs/manifest.webmanifest',
  icons: {
    icon: { url: '/crew-jobs/waypoint-compass-crown-v2-32.png', sizes: '32x32', type: 'image/png' },
    apple: { url: '/crew-jobs/waypoint-compass-crown-v2-180.png', sizes: '180x180', type: 'image/png' },
  },
  appleWebApp: { capable: true, title: 'Waypoint', statusBarStyle: 'default' },
  robots: { index: false, follow: false },
};

export default function WaypointLayout({ children }: { children: React.ReactNode }) {
  return children;
}
