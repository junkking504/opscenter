CREATE TABLE IF NOT EXISTS opscenter_kernel.waypoint_push_devices (
 id uuid PRIMARY KEY, owner_id text NOT NULL, phone_id uuid NOT NULL,
 endpoint_hash text NOT NULL UNIQUE, subscription_json jsonb NOT NULL,
 enabled boolean NOT NULL DEFAULT true, updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS opscenter_kernel.waypoint_push_baselines (
 device_id uuid NOT NULL REFERENCES opscenter_kernel.waypoint_push_devices(id),
 kind text NOT NULL CHECK(kind IN ('schedule','messages')),
 scope text NOT NULL, revision text NOT NULL, updated_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(device_id,kind)
);
CREATE TABLE IF NOT EXISTS opscenter_kernel.waypoint_messages (
 id uuid PRIMARY KEY, truck text NOT NULL, service_date date NOT NULL,
 actor text NOT NULL, body text NOT NULL CHECK(length(body) BETWEEN 1 AND 1000),
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS opscenter_kernel.waypoint_push_deliveries (
 id uuid PRIMARY KEY, device_id uuid NOT NULL REFERENCES opscenter_kernel.waypoint_push_devices(id),
 phone_id uuid NOT NULL, truck text NOT NULL, service_date date NOT NULL,
 status text NOT NULL CHECK(status IN ('pending','sending','accepted','rejected','expired','skipped','uncertain')),
 created_at timestamptz NOT NULL DEFAULT now(), attempted_at timestamptz
);
CREATE INDEX IF NOT EXISTS waypoint_push_pending ON opscenter_kernel.waypoint_push_deliveries(created_at) WHERE status='pending';
