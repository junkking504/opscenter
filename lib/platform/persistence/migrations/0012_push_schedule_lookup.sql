-- Correlate only the same canonical appointment across retained schedule scopes.
CREATE INDEX IF NOT EXISTS push_observations_schedule_identity_idx
ON opscenter_kernel.push_observations(identity_hash) WHERE scope LIKE 'schedule:%';
