import type { Metadata, Viewport } from 'next';

export const metadata: Metadata = {
  title: { absolute: 'Waypoint' },
  applicationName: 'Waypoint',
  description: 'Junk King company-phone jobs, inspections and crew.',
  manifest: '/crew-jobs/manifest.webmanifest',
  icons: {
    icon: { url: '/crew-jobs/waypoint-favicon-v2.png', sizes: '32x32', type: 'image/png' },
    shortcut: '/crew-jobs/waypoint-favicon-v2.png',
    apple: { url: '/crew-jobs/waypoint-crown-road-v1-180.png', sizes: '180x180', type: 'image/png' },
  },
  appleWebApp: { capable: true, title: 'Waypoint', statusBarStyle: 'black' },
  robots: { index: false, follow: false },
};

export const viewport:Viewport={width:'device-width',initialScale:1,viewportFit:'cover',themeColor:'#171717',colorScheme:'light'};

export default function WaypointLayout({ children }: { children: React.ReactNode }) {
  return children;
}
