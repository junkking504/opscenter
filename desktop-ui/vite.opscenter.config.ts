import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/postcss';

// Keep the approved React components and Tailwind 4 cascade together. This
// produces assets for OpsCenter's authenticated server, not a second service.
export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  base: '/desktop-assets/',
  plugins: [react()],
  resolve: { dedupe: ['react', 'react-dom'], alias: { '@': fileURLToPath(new URL('.', import.meta.url)) } },
  css: { postcss: { plugins: [tailwindcss()] } },
  build: {
    outDir: fileURLToPath(new URL('../public/desktop-assets', import.meta.url)),
    emptyOutDir: true,
    sourcemap: false,
  },
});
