export function GET() {
  return Response.json({
    name: 'Waypoint', short_name: 'Waypoint',
    start_url: '/crew-jobs', scope: '/crew-jobs', display: 'standalone',
    background_color: '#f5f4f0', theme_color: '#171717',
    icons: [
      { src: '/crew-jobs/waypoint-crown-road-v1-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/crew-jobs/waypoint-crown-road-v1-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
    ],
  }, { headers: { 'Content-Type': 'application/manifest+json' } });
}
