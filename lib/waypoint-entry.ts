/** Fixed, same-origin destinations only; never trust a notification URL as authority. */
export const WAYPOINT_UPDATES_PATH='/crew-jobs?view=updates';
export function waypointEntryTarget(value:unknown) {
 return value===WAYPOINT_UPDATES_PATH?WAYPOINT_UPDATES_PATH:'/crew-jobs';
}
