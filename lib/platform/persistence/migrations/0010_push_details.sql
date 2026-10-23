-- Private runtime message descriptions; no credentials or raw source records.
ALTER TABLE opscenter_kernel.push_observations ADD COLUMN notification_json jsonb;
ALTER TABLE opscenter_kernel.push_events ADD COLUMN notification_json jsonb;
