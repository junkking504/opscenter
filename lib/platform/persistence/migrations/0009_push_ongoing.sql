-- Inert until an operator promotes the exact handset after confirmed acceptance.
-- Preserve the original trial deadline, lifetime cap and reservation ledger.
ALTER TABLE opscenter_kernel.push_trial
 ADD COLUMN ongoing_started_at timestamptz,
 ADD COLUMN ongoing_expires_at timestamptz,
 ADD CONSTRAINT push_ongoing_window CHECK (
  (ongoing_started_at IS NULL AND ongoing_expires_at IS NULL) OR
  (ongoing_started_at IS NOT NULL AND ongoing_expires_at IS NOT NULL AND
   ongoing_expires_at > ongoing_started_at AND ongoing_expires_at <= ongoing_started_at + interval '30 days'));
ALTER TABLE opscenter_kernel.push_devices ADD COLUMN enrollment_expires_at timestamptz;
CREATE TABLE opscenter_kernel.push_ongoing_attempts (
 claim_token text PRIMARY KEY, event_id text NOT NULL, device_id text NOT NULL,
 reserved_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX push_ongoing_attempts_reserved ON opscenter_kernel.push_ongoing_attempts(reserved_at);
