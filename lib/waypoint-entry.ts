/** Fixed, same-origin destinations only; never trust a notification URL as authority. */
export const WAYPOINT_UPDATES_PATH='/crew-jobs?view=updates';
export function waypointUpdatePath(value:unknown):string|undefined {
 if(typeof value!=='string')return undefined;
 return /^\/crew-jobs\?view=updates(?:&update=[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12})?$/.test(value)?value:undefined;
}
export function waypointEntryTarget(value:unknown) {
 return waypointUpdatePath(value)||'/crew-jobs';
}
