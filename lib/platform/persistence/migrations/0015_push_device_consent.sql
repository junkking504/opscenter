-- Only an explicit authenticated ON action sets consent. Existing grants and
-- revoked devices retain their original state; no automatic migration to ON.
ALTER TABLE opscenter_kernel.push_devices ALTER COLUMN expires_at DROP NOT NULL;
ALTER TABLE opscenter_kernel.push_devices ADD COLUMN consented_at timestamptz;
ALTER TABLE opscenter_kernel.push_devices ADD COLUMN consent_fingerprint text;
ALTER TABLE opscenter_kernel.push_devices ADD CONSTRAINT push_device_consent_pair
  CHECK ((consented_at IS NULL) = (consent_fingerprint IS NULL));
ALTER TABLE opscenter_kernel.push_devices ADD CONSTRAINT push_device_expiry_or_consent
  CHECK (expires_at IS NOT NULL OR consented_at IS NOT NULL);
ALTER TABLE opscenter_kernel.push_devices ADD COLUMN invalidated_at timestamptz;
