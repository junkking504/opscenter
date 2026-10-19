-- Apply only during separately approved deployment. No credentials in this schema.
CREATE TABLE opscenter_kernel.push_devices (
 id text PRIMARY KEY, owner_id text NOT NULL, endpoint_hash text UNIQUE NOT NULL,
 subscription_json jsonb NOT NULL, categories text[] NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(), expires_at timestamptz NOT NULL,
 CHECK (categories <@ ARRAY['schedule','krewe','fleet']::text[])
);
CREATE INDEX push_devices_owner ON opscenter_kernel.push_devices(owner_id);
CREATE TABLE opscenter_kernel.push_sources (
 scope text PRIMARY KEY, observed_at timestamptz NOT NULL
);
CREATE TABLE opscenter_kernel.push_events (
 id text PRIMARY KEY, category text NOT NULL, observed_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE opscenter_kernel.push_deliveries (
 event_id text REFERENCES opscenter_kernel.push_events(id) ON DELETE CASCADE,
 device_id text REFERENCES opscenter_kernel.push_devices(id) ON DELETE CASCADE,
 status text NOT NULL DEFAULT 'pending', attempted_at timestamptz,
 PRIMARY KEY(event_id,device_id),
 CHECK(status IN ('pending','sending','accepted','expired','rejected','uncertain','skipped'))
);
CREATE TABLE opscenter_kernel.push_audit (
 id bigserial PRIMARY KEY, owner_id text NOT NULL, action text NOT NULL,
 device_id text NOT NULL, recorded_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE opscenter_kernel.push_observations (
 scope text NOT NULL, identity_hash text NOT NULL, revision_hash text NOT NULL,
 version integer NOT NULL, observed_at timestamptz NOT NULL,
 PRIMARY KEY(scope,identity_hash)
);
