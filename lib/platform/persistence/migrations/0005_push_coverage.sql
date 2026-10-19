-- Prepared locally only. Requires separately approved production migration.
ALTER TABLE opscenter_kernel.push_sources ADD COLUMN generation text NOT NULL DEFAULT 'legacy';
ALTER TABLE opscenter_kernel.push_sources ADD COLUMN source_recorded_at timestamptz;
ALTER TABLE opscenter_kernel.push_events ADD COLUMN source_recorded_at timestamptz;
CREATE TABLE opscenter_kernel.push_gaps (
 scope text PRIMARY KEY, gap_id text NOT NULL, code text NOT NULL,
 observed_at timestamptz NOT NULL, recorded_at timestamptz NOT NULL DEFAULT now()
);
