const listeners = new Set<() => void>();
let events: EventSource | undefined;

/** Share one incoming source-change stream between Command and Schedule. */
export function subscribeArrivalUpdates(listener: () => void) {
  listeners.add(listener);
  if (!events) {
    events = new EventSource('/api/desktop/events');
    const notify = () => { for (const callback of listeners) callback(); };
    events.addEventListener('change', notify);
    events.addEventListener('open', notify);
  }
  return () => { listeners.delete(listener); if (!listeners.size) { events?.close(); events = undefined; } };
}
