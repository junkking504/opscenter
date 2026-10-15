// Compatibility bridge for the Python matcher. Approximate map evidence is
// navigation-only. Verified locations come from the matcher's verified cache.
import fs from 'node:fs';
const addresses: string[]=JSON.parse(fs.readFileSync(0,'utf8'));
if(!Array.isArray(addresses)||!addresses.every(value=>typeof value==='string'))throw new Error('Invalid visit address input');
process.stdout.write(JSON.stringify(Object.fromEntries([...new Set(addresses)].map(address=>[address,null]))));
