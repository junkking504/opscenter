import {defineConfig} from 'vite';
import react from '@vitejs/plugin-react';
import {fileURLToPath} from 'node:url';
export default defineConfig({root:fileURLToPath(new URL('../',import.meta.url)),plugins:[react()],cacheDir:fileURLToPath(new URL('../../.cache/maintenance-vite',import.meta.url)),resolve:{alias:{'@':fileURLToPath(new URL('../',import.meta.url))}},server:{host:'127.0.0.1',port:3189,strictPort:true}});
