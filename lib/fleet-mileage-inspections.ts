import fs from 'node:fs';
import path from 'node:path';
import type { InspectionMileage } from './fleet-mileage';

// Cache only metadata, not the photographs embedded in immutable reports.
const cache = new Map<string, { signature: string; row: InspectionMileage }>();
export function readInspectionMileage(): InspectionMileage[] {
  const root = process.env.OPS_TRUCK_INSPECTION_DIR || path.join(process.env.OPSCENTER_DATA_DIR || process.env.OPSBOT_DATA_DIR || path.join(process.cwd(), 'data'), 'fleet', 'truck-inspections');
  const dir = path.join(root, 'reports');
  if (!fs.existsSync(dir)) return [];
  const files = fs.readdirSync(dir).filter(file => /^[a-f0-9]{64}\.json$/.test(file));
  const paths = new Set(files.map(file => path.join(dir,file)));
  for (const file of cache.keys()) if (!paths.has(file)) cache.delete(file);
  return [...paths].map(file => {
    const stat = fs.statSync(file), signature = `${stat.mtimeMs}:${stat.size}`;
    if (cache.get(file)?.signature === signature) return cache.get(file)!.row;
    const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
    const row = Object.fromEntries(['truck','odometer','startedAt','receivedAt','inspectionDate','deviceId','requestId'].map(key => [key, String(raw[key] ?? '')])) as InspectionMileage;
    cache.set(file, { signature, row }); return row;
  });
}
