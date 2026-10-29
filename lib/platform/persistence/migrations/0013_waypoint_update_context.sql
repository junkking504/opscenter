-- Backward-compatible additions; retain delivery history and the existing gates.
ALTER TABLE opscenter_kernel.waypoint_push_baselines ADD COLUMN IF NOT EXISTS projection_json jsonb;
ALTER TABLE opscenter_kernel.waypoint_push_deliveries ADD COLUMN IF NOT EXISTS context_json jsonb NOT NULL DEFAULT '{}';
ALTER TABLE opscenter_kernel.waypoint_push_deliveries ADD COLUMN IF NOT EXISTS not_before timestamptz NOT NULL DEFAULT now();
CREATE INDEX IF NOT EXISTS waypoint_push_due ON opscenter_kernel.waypoint_push_deliveries(not_before) WHERE status='pending';
