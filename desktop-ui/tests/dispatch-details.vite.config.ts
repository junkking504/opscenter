import {defineConfig} from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/postcss';
import {fileURLToPath} from 'node:url';
export default defineConfig({
  root:fileURLToPath(new URL('../',import.meta.url)),
  plugins:[react(),{name:'synthetic-map',enforce:'pre',load(id){if(id.endsWith('/desktop-ui/schedule-map.tsx'))return `export default function Map({appointments,onSelect}) {return <div style={{paddingTop:130}} aria-label="Synthetic map">{appointments.map(job=><button key={job.recordId} aria-label={'Synthetic map marker '+job.jkNumber} onClick={()=>onSelect(job.recordId)}>Appointment marker</button>)}</div>}`;}}],
  resolve:{dedupe:['react','react-dom'],alias:{'@':fileURLToPath(new URL('../',import.meta.url))}},
  css:{postcss:{plugins:[tailwindcss()]}},server:{host:'127.0.0.1',port:3156,strictPort:true},
});
