import type { DesktopFleetTruck } from './lib/people-fleet-contract';

export const gaugeTime = (at?: string) => at && Number.isFinite(Date.parse(at))
  ? new Date(at).toLocaleString('en-US', { timeZone: 'America/Chicago', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) + ' CT' : 'Time not recorded';

export function ConvoyGauge({ label, percent, value, detail, tone = 'good', ends = ['Empty', 'Full'] }: {
  label: string; percent: number | null; value?: string; detail?: string; tone?: string; ends?: [string, string];
}) {
  const known = percent !== null && Number.isFinite(percent);
  const amount = known ? Math.min(100, Math.max(0, percent)) : 0;
  return <div className={`convoy-gauge ${known ? tone : 'unknown'}`}>
    <span className="convoy-gauge-label">{label}</span>
    <div className="convoy-gauge-dial" role="img" aria-label={`${label}: ${value || (known ? `${percent}%` : 'Not recorded')}`}>
      <svg viewBox="0 0 180 108" aria-hidden="true">
        <path className="convoy-gauge-track" d="M 18 90 A 72 72 0 0 1 162 90" pathLength="100"/>
        {known && <path className="convoy-gauge-fill" d="M 18 90 A 72 72 0 0 1 162 90" pathLength="100" strokeDasharray={`${amount} 100`}/>}
        {known && <g transform={`rotate(${amount * 1.8 - 90} 90 90)`}><path className="convoy-gauge-needle" d="M 90 86 L 90 39"/><circle cx="90" cy="90" r="5"/></g>}
      </svg>
      <strong>{value || (known ? `${percent}%` : 'Not recorded')}</strong>
    </div>
    <div className="convoy-gauge-ends"><span>{ends[0]}</span><span>{ends[1]}</span></div>
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
