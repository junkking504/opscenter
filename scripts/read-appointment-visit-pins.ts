// Local cache reader for the Python matcher. No provider calls or file writes.
import fs from 'node:fs';
import {readAddressMapFallback} from '../lib/address-map-fallback';
const addresses: string[]=JSON.parse(fs.readFileSync(0,'utf8'));
if(!Array.isArray(addresses)||!addresses.every(value=>typeof value==='string'))throw new Error('Invalid visit address input');
process.stdout.write(JSON.stringify(Object.fromEntries([...new Set(addresses)].map(address=>[address,readAddressMapFallback(address)]))));
