import assert from 'node:assert/strict';
import { appleMapsConfig } from '../lib/apple-maps-config';
assert.deepEqual(appleMapsConfig({}), { provider: 'openstreetmap' });
assert.deepEqual(appleMapsConfig({ OPSCENTER_APPLE_MAPS_TOKEN: 'test-token' }), { provider: 'openstreetmap' });
assert.deepEqual(appleMapsConfig({ OPSCENTER_APPLE_MAPS_ENABLED: '1', OPSCENTER_APPLE_MAPS_TOKEN: '  ' }), { provider: 'openstreetmap' });
assert.deepEqual(appleMapsConfig({ OPSCENTER_APPLE_MAPS_ENABLED: '1', OPSCENTER_APPLE_MAPS_TOKEN: ' test-token ' }), { provider: 'apple', token: 'test-token' });
assert.deepEqual(appleMapsConfig({ OPSCENTER_APPLE_MAPS_ENABLED: '0', OPSCENTER_APPLE_MAPS_TOKEN: 'test-token' }), { provider: 'openstreetmap' });
console.log('Apple Maps activation is opt-in and fails closed without a browser token.');
