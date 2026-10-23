-- Local preparation only; application requires separate deployment approval.
ALTER TABLE opscenter_kernel.push_devices ADD COLUMN revoked_at timestamptz;
ALTER TABLE opscenter_kernel.push_sources ADD COLUMN sequence bigint NOT NULL DEFAULT 0;
ALTER TABLE opscenter_kernel.push_sources ADD COLUMN baseline_complete boolean NOT NULL DEFAULT false;
ALTER TABLE opscenter_kernel.push_observations ADD COLUMN present boolean NOT NULL DEFAULT true;
ALTER TABLE opscenter_kernel.push_events ADD COLUMN occurred_at timestamptz;
ALTER TABLE opscenter_kernel.push_events ADD COLUMN recorded_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE opscenter_kernel.push_deliveries ADD COLUMN claim_token text;
ALTER TABLE opscenter_kernel.push_deliveries ADD COLUMN reason text;
CREATE INDEX push_pending ON opscenter_kernel.push_deliveries(status);
CREATE TABLE opscenter_kernel.push_health (
 scope text PRIMARY KEY, code text NOT NULL, recorded_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE opscenter_kernel.push_batches (
 scope text NOT NULL, sequence bigint NOT NULL, digest text NOT NULL,
 PRIMARY KEY(scope,sequence)
);
