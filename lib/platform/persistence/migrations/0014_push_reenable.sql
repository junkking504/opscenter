-- Pending verification only. This table does not grant delivery permission.
CREATE TABLE IF NOT EXISTS opscenter_kernel.push_reenable_requests (
  owner_id text PRIMARY KEY,
  id uuid NOT NULL UNIQUE,
  source_device_id text NOT NULL REFERENCES opscenter_kernel.push_devices(id),
  source_revoked_at timestamptz NOT NULL,
  subscription_json jsonb NOT NULL,
  fingerprint text NOT NULL,
  categories text[] NOT NULL,
  requested_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  grant_expires_at timestamptz NOT NULL
);

ALTER TABLE opscenter_kernel.push_trial ADD COLUMN reenabled_at timestamptz;
