import { useEffect, useState } from 'react';
import type { ScheduleTruck } from './lib/schedule-contract';
import { truckTelemetry } from './lib/truck-telemetry';
import './truck-telemetry.css';

export function TruckTelemetry({ truck }: { truck?: ScheduleTruck }) {
  const [, setNow] = useState(Date.now);
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);
  const telemetry = truckTelemetry(truck);
  return <div className="truck-telemetry"><dt>{telemetry.label}</dt><dd>
    <strong aria-live="polite">{telemetry.speed}</strong>
    <span> · {telemetry.reportAge}{!telemetry.recent ? ' · Current speed unknown' : ''}</span>
    <small>Position and speed update with each GPS report.</small>
  </dd></div>;
}
