/** The truck choices supported by JunkWare appointment creation. Keep dispatch
 * destinations independent of appointments, telemetry, and the selected date. */
export const JUNKWARE_DISPATCH_TRUCKS = Array.from({length:9}, (_, index) => `Truck ${index + 1}`);

/** Stable identity; legacy storage keys and phone credentials must not be renamed. */
export function truckNumber(value: unknown): number | null {
  const match = String(value ?? '').trim().match(/^(?:truck\s*#?\s*|t\s*#?\s*|#\s*)?(\d{1,3})$/i);
  const number = match ? Number(match[1]) : 0;
  return number > 0 ? number : null;
}
export function sameTruck(left: unknown, right: unknown): boolean {
  const number = truckNumber(left);
  return number !== null && number === truckNumber(right);
}
/** JunkWare's visible name, independent of storage keys and request values. */
export function truckDisplayLabel(value: string): string {
  const number = truckNumber(value);
  return number === null ? value : `Truck# ${number}`;
}
/** Format human-readable copy, preserving URLs, channel names, IDs and unknown labels. */
export function truckDisplayText<T extends string | null | undefined>(value: T): T {
  if (typeof value !== 'string') return value;
  return value.split(/(https?:\/\/[^\s<>|]+)/g).map((part, index) => index % 2 ? part :
    part.replace(/\bTruck\s*#?\s*(\d{1,3})(?![\w-])/gi, (label, number) => Number(number) > 0 ? `Truck# ${Number(number)}` : label)).join('') as T;
}
