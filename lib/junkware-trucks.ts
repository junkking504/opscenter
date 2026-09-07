/** The truck choices supported by JunkWare appointment creation. Keep dispatch
 * destinations independent of appointments, telemetry, and the selected date. */
export const JUNKWARE_DISPATCH_TRUCKS = Array.from({length:9}, (_, index) => `Truck ${index + 1}`);
