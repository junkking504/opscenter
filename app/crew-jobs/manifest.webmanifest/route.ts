export function GET() {
  return Response.json({
    name: 'Kingpin', short_name: 'Kingpin',
    start_url: '/crew-jobs', scope: '/crew-jobs', display: 'standalone',
    background_color: '#f5f4f0', theme_color: '#171717',
    icons: [{ src: '/crew-jobs/icon.png', sizes: '180x180', type: 'image/png' }],
  }, { headers: { 'Content-Type': 'application/manifest+json' } });
}
