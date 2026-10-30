import assert from 'node:assert/strict';
import {waypointAppleMapsConfig,waypointAppleMapsEnabled} from '../lib/waypoint-apple-maps-config';
import {CREW_JOBS_PUBLIC_PATHS} from '../lib/crew-phone';

assert.deepEqual(waypointAppleMapsConfig({}),{provider:'openstreetmap'},'off by default');
assert.deepEqual(waypointAppleMapsConfig({OPSCENTER_WAYPOINT_APPLE_MAPS_ENABLED:'1'}),{provider:'openstreetmap'},'needs a token');
assert.deepEqual(waypointAppleMapsConfig({OPSCENTER_WAYPOINT_APPLE_MAPS_TOKEN:'tok'}),{provider:'openstreetmap'},'needs the switch');
assert.deepEqual(waypointAppleMapsConfig({OPSCENTER_WAYPOINT_APPLE_MAPS_ENABLED:'true',OPSCENTER_WAYPOINT_APPLE_MAPS_TOKEN:'tok'}),{provider:'openstreetmap'},'only "1" enables');
assert.deepEqual(waypointAppleMapsConfig({OPSCENTER_WAYPOINT_APPLE_MAPS_ENABLED:'1',OPSCENTER_WAYPOINT_APPLE_MAPS_TOKEN:'  tok  '}),{provider:'apple',token:'tok'});
// The Command map's switch and token (restricted to the office site) must not enable Waypoint.
assert.deepEqual(waypointAppleMapsConfig({OPSCENTER_APPLE_MAPS_ENABLED:'1',OPSCENTER_APPLE_MAPS_TOKEN:'office'}),{provider:'openstreetmap'});
assert.equal(waypointAppleMapsEnabled({OPSCENTER_WAYPOINT_APPLE_MAPS_ENABLED:'1',OPSCENTER_WAYPOINT_APPLE_MAPS_TOKEN:'tok'}),true);
assert.equal(waypointAppleMapsEnabled({}),false);
assert.ok(CREW_JOBS_PUBLIC_PATHS.includes('/api/crew-jobs/maps'),'phone host must route the maps endpoint');
console.log('PASS Waypoint Apple Maps config: off by default, own switch and token, office token cannot enable it, phone route allowed.');
