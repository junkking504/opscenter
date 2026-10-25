import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/postcss';
import { OPS_THEME_BOOTSTRAP } from '../lib/ops-theme';

// Keep the approved React components and Tailwind 4 cascade together. This
// produces assets for OpsCenter's authenticated server, not a second service.
export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  base: '/desktop-assets/',
  plugins: [react(), { name: 'ops-theme-before-paint', transformIndexHtml: { order: 'pre', handler: () => [{ tag: 'script', children: OPS_THEME_BOOTSTRAP, injectTo: 'head-prepend' }] } }],
  resolve: { dedupe: ['react', 'react-dom'], alias: { '@': fileURLToPath(new URL('.', import.meta.url)) } },
  css: { postcss: { plugins: [tailwindcss()] } },
  build: {
    manifest: true,
    outDir: fileURLToPath(new URL('../public/desktop-assets', import.meta.url)),
    emptyOutDir: true,
    sourcemap: false,
  },
});
