import type { DesktopFleetTruck } from './lib/people-fleet-contract';

export const gaugeTime = (at?: string) => at && Number.isFinite(Date.parse(at))
  ? new Date(at).toLocaleString('en-US', { timeZone: 'America/Chicago', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) + ' CT' : 'Time not recorded';

export function ConvoyGauge({ label, percent, value, detail, tone = 'good', ends = ['Empty', 'Full'] }: {
  label: string; percent: number | null; value?: string; detail?: string; tone?: string; ends?: [string, string];
}) {
  const known = percent !== null && Number.isFinite(percent);
  const amount = known ? Math.min(100, Math.max(0, percent)) : 0;
  return <div className={`convoy-reading ${known ? tone : 'unknown'}`}>
    <div className="convoy-reading-heading">
      <span>{label}</span>
      <strong>{value || (known ? `${percent}%` : 'Not recorded')}</strong>
    </div>
    {known && <div className="convoy-reading-track" aria-hidden="true" title={`${ends[0]} → ${ends[1]}`}>
      <span style={{ width: `${amount}%` }}/>
    </div>}
    {detail && <small>{detail}</small>}
  </div>;
}

export function TruckLevelGauges({ truck, inspection = false }: { truck: DesktopFleetTruck; inspection?: boolean }) {
  const fuel = inspection ? truck.inspectionLevels?.fuel ?? null : truck.fuel?.percent ?? null;
  const load = inspection ? truck.inspectionLevels?.load ?? null : truck.loadNeedsVerification ? null : truck.loadPercent;
  const fuelDetail = inspection ? gaugeTime(truck.inspectionLevels?.at) : truck.fuel ? `${truck.fuel.detail} · ${gaugeTime(truck.fuel.at)}` : 'No fuel level or fill-up recorded for this day';
  return <div className="convoy-level-gauges">
    <ConvoyGauge label={inspection ? 'Fuel at inspection' : 'Fuel · latest record'} percent={fuel} tone={fuel !== null && fuel <= 25 ? 'warning' : 'fuel'} detail={fuelDetail}/>
    <ConvoyGauge label={inspection ? 'Load at inspection' : 'Onboard load'} percent={load} tone={load !== null && load >= 90 ? 'warning' : 'load'} value={!inspection && truck.loadNeedsVerification ? 'Confirm load' : undefined} detail={inspection ? gaugeTime(truck.inspectionLevels?.at) : load === null ? 'Record a current observation to establish capacity' : `Recorded estimate · ${gaugeTime(truck.loadUpdatedAt)}`}/>
  </div>;
}
