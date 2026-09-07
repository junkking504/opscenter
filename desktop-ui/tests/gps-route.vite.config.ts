import {defineConfig} from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/postcss';
import {fileURLToPath} from 'node:url';
export default defineConfig({
  root:fileURLToPath(new URL('../',import.meta.url)),plugins:[react()],
  resolve:{dedupe:['react','react-dom'],alias:{'@':fileURLToPath(new URL('../',import.meta.url))}},
  css:{postcss:{plugins:[tailwindcss()]}},server:{host:'127.0.0.1',port:3140,strictPort:true},
});
