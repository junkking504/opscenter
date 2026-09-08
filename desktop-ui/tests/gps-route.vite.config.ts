import {defineConfig} from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/postcss';
import {fileURLToPath} from 'node:url';
export default defineConfig({
  root:fileURLToPath(new URL('../',import.meta.url)),plugins:[react(),{name:'synthetic-street-tiles',configureServer(server){server.middlewares.use((req,res,next)=>{
    if(!req.url?.startsWith('/api/desktop/map?kind=tile'))return next();
    res.setHeader('Content-Type','image/svg+xml');res.end('<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256"><rect width="256" height="256" fill="#e7ece8"/><path d="M0 128H256M128 0V256" stroke="white" stroke-width="8"/><text x="8" y="20" font-size="12">Synthetic street map</text></svg>');
  });}}],
  resolve:{dedupe:['react','react-dom'],alias:{'@':fileURLToPath(new URL('../',import.meta.url))}},
  css:{postcss:{plugins:[tailwindcss()]}},server:{host:'127.0.0.1',port:3140,strictPort:true},
});
