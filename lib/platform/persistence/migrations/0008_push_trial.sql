-- Inert singleton: deployment neither chooses a device nor starts the clock.
CREATE TABLE opscenter_kernel.push_trial (
 singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton),
 owner_id text, device_id text, subscription_hash text, approved_at timestamptz,
 started_at timestamptz, deadline timestamptz, stopped_at timestamptz,
 attempts_used integer NOT NULL DEFAULT 0 CHECK(attempts_used BETWEEN 0 AND 3),
 approval_reference text,
 CHECK(device_id IS NULL OR owner_id IS NOT NULL),
 CHECK((started_at IS NULL AND deadline IS NULL) OR
       (started_at IS NOT NULL AND deadline IS NOT NULL AND deadline = started_at + interval '30 minutes')),
 CHECK((device_id IS NULL AND subscription_hash IS NULL AND approved_at IS NULL) OR
       (device_id IS NOT NULL AND subscription_hash IS NOT NULL AND approved_at IS NOT NULL))
);
INSERT INTO opscenter_kernel.push_trial(singleton) VALUES(true);
-- No cascading references: reservations survive event/device retention and crashes.
CREATE TABLE opscenter_kernel.push_trial_attempts (
 ordinal integer PRIMARY KEY CHECK(ordinal BETWEEN 1 AND 3),
 claim_token text UNIQUE NOT NULL, event_id text NOT NULL, device_id text NOT NULL,
 reserved_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE opscenter_kernel.push_trial_audit (
 id bigserial PRIMARY KEY, action text NOT NULL, reference text NOT NULL,
 device_id text, recorded_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
