import { usesWaypointInspection } from '@/lib/inspection-entry';
import { GET as waypointManifest } from '../../crew-jobs/manifest.webmanifest/route';

export function GET(request: Request) {
  if (usesWaypointInspection(request.headers)) return waypointManifest();
  return Response.json({
    name: 'Convoy', short_name: 'Convoy',
    id: '/truck-inspection', start_url: '/truck-inspection', scope: '/truck-inspection', display: 'standalone',
    background_color: '#f5f4f0', theme_color: '#171717',
    icons: [
      { src: '/truck-inspection/convoy-gear-crown-v2-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/truck-inspection/convoy-gear-crown-v2-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
    ],
  }, { headers: { 'Content-Type': 'application/manifest+json', 'Cache-Control': 'no-store' } });
}
