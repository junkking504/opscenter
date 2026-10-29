import base from './area-colors.vite.config';
import { fileURLToPath } from 'node:url';
export default { ...base, publicDir:fileURLToPath(new URL('../../public/',import.meta.url)), server:{host:'127.0.0.1',port:3167,strictPort:true} };
