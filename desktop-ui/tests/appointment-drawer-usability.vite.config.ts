import {defineConfig} from 'vite';
import tailwindcss from '@tailwindcss/postcss';
import react from '@vitejs/plugin-react';
import {fileURLToPath} from 'node:url';
export default defineConfig({root:fileURLToPath(new URL('../',import.meta.url)),plugins:[react()],css:{postcss:{plugins:[tailwindcss()]}},resolve:{alias:{'@':fileURLToPath(new URL('../',import.meta.url))}},server:{host:'127.0.0.1',port:3190,strictPort:true}});
