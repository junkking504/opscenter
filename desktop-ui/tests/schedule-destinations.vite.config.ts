import {defineConfig} from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/postcss';
import {fileURLToPath} from 'node:url';
export default defineConfig({
  root:fileURLToPath(new URL('../',import.meta.url)),
  plugins:[react(),{name:'synthetic-map',enforce:'pre',load(id){if(id.endsWith('/desktop-ui/schedule-map.tsx'))return 'export default function Map(){return <div aria-label="Synthetic map placeholder">Map omitted from this isolated dispatch test.</div>}';},configureServer(server){server.middlewares.use((req,_res,next)=>{if(req.url?.split('?')[0]==='/desktop')req.url=req.url.replace('/desktop','/tests/alert-records.html');next();});}}],
  resolve:{dedupe:['react','react-dom'],alias:{'@':fileURLToPath(new URL('../',import.meta.url))}},
  css:{postcss:{plugins:[tailwindcss()]}},
  server:{host:'127.0.0.1',port:3139,strictPort:true},
});
