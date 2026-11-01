import { TriangleAlert } from 'lucide-react';
import './missing-punch-warning.css';

export function MissingPunchWarning({ label }: { label: string }) {
  if (!label) return null;
  return <p className="missing-punch-warning"><TriangleAlert aria-hidden="true" size={18}/><span><strong>{label}</strong><span>Confirm the actual time before correcting this record.</span></span></p>;
}
