/** Compact local times for completed visits; retain dates for overnight stays. */
export function geofenceOnsiteSummary(duration: string, arrival: string | null, departure: string | null): string {
  const date = (stamp: string) => new Intl.DateTimeFormat('en-CA',{timeZone:'America/Chicago'}).format(new Date(stamp));
  const overnight = arrival && departure && date(arrival) !== date(departure);
  const clock = (stamp: string) => new Intl.DateTimeFormat('en-US',{
    timeZone:'America/Chicago',hour:'numeric',minute:'2-digit',
    ...(overnight ? {month:'short' as const,day:'numeric' as const} : {}),
  }).format(new Date(stamp)).replace(/\s+(AM|PM)$/,(_,period:string)=>period.toLowerCase());
  return `${duration}  |  ${arrival ? clock(arrival) : 'Arrival unavailable'} - ${departure ? clock(departure) : 'awaiting departure'}`;
}
