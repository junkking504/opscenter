import base from '../vite.opscenter.config';
import { fileURLToPath } from 'node:url';
import type { ViteDevServer } from 'vite';
const config = {
  ...base,
  plugins: [...(base.plugins || []), {
    name: 'fixture-root-wordmark',
    configureServer(server: ViteDevServer) {
      server.middlewares.use((request, _response, next) => {
        if (request.url?.split('?')[0] === '/opscenter-wordmark.png') request.url = `/desktop-assets${request.url}`;
        next();
      });
    },
  }],
  cacheDir: process.env.OPSCENTER_FIXTURE_CACHE_DIR || '/tmp/dashboard-hierarchy-vite-cache',
  publicDir: fileURLToPath(new URL('../../public/', import.meta.url)),
  server: { host: '127.0.0.1', port: 3189, strictPort: true },
};
export default config;
