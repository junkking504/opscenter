/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  distDir: process.env.NEXT_DIST_DIR || ".next",
  async headers() {
    return [{ source: '/desktop-assets/assets/:asset', headers: [
      { key: 'Cache-Control', value: 'public, max-age=31536000, immutable' },
    ] }];
  }
};

export default nextConfig;
