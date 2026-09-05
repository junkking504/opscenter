import { truckLabel, unavailableRoute, type ScheduleAppointment, type ScheduleRouteLeg } from './lib/schedule-contract';

export default function ScheduleTravel({ legs, jobs, select }: { legs: ScheduleRouteLeg[]; jobs: ScheduleAppointment[]; select: (id: string) => void }) {
  if (!legs.length) return null;
  const trucks = [...new Set(legs.map(leg => truckLabel(leg.truck)))];
  return <section className="schedule-travel" aria-label="Travel Between Appointments">
    <header><h2>Travel Between Appointments</h2><p>Proposed stop order · Same-window appointments stay separate. This does not change assignments or promise arrival times.</p></header>
    {trucks.map(truck => <div className="schedule-travel-truck" key={truck}><strong>{truck}</strong><div className="schedule-travel-legs">
      {legs.filter(leg => truckLabel(leg.truck) === truck).map((leg, index) => <article key={`${leg.fromAppointmentId}:${leg.toAppointmentId}`} className={`schedule-travel-pair${leg.travelMinutes === null ? ' unavailable' : ''}`}>
        <div><span className="schedule-stop-number">{index + 1}</span><button onClick={() => select(leg.fromAppointmentId)}>{leg.fromJk || 'JK Pending'}</button><span aria-hidden="true">→</span><span className="schedule-stop-number">{index + 2}</span><button onClick={() => select(leg.toAppointmentId)}>{leg.toJk || 'JK Pending'}</button></div>
        <strong title={leg.travelMinutes === null ? unavailableRoute(leg, jobs).detail : undefined}>{leg.travelMinutes === null ? unavailableRoute(leg, jobs).label : `${leg.travelMinutes} min · ${leg.miles} mi`}</strong>
        {leg.gapMinutes === null ? <small>Time Not Set · Order Needs Review</small> : leg.gapMinutes < 0 ? <small>Overlapping Windows · Proposed Order</small> : leg.gapMinutes === 0 ? <small>Back-to-Back Windows</small> : null}
      </article>)}
    </div></div>)}
  </section>;
}
