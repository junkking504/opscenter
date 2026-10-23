-- Local preparation only. No live migration authorized.
ALTER TABLE opscenter_kernel.push_gaps ADD COLUMN resolved_at timestamptz;
ALTER TABLE opscenter_kernel.push_gaps ADD COLUMN recovered_generation text;
