-- Prepared only. No production migration is performed by tests or source hooks.
ALTER TABLE opscenter_kernel.push_sources ADD COLUMN archived_sequence bigint NOT NULL DEFAULT 0;
ALTER TABLE opscenter_kernel.push_events ADD COLUMN dispatch_order bigserial;
CREATE INDEX push_event_dispatch_order ON opscenter_kernel.push_events(dispatch_order);
