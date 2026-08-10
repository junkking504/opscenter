CREATE SCHEMA IF NOT EXISTS opscenter_kernel;

CREATE TABLE opscenter_kernel.actors (
  id text PRIMARY KEY,
  kind text NOT NULL CHECK (kind IN ('human', 'service', 'schedule', 'agent')),
  external_identity text NOT NULL,
  display_name text NOT NULL,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (kind, external_identity)
);

CREATE TABLE opscenter_kernel.actor_roles (
  actor_id text NOT NULL REFERENCES opscenter_kernel.actors(id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('admin', 'operator', 'manager', 'crew', 'service', 'agent')),
  resource_scope text NOT NULL DEFAULT '*',
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (actor_id, role, resource_scope)
);

CREATE TABLE opscenter_kernel.work_items (
  id text PRIMARY KEY,
  dedupe_key text NOT NULL UNIQUE,
  operating_date date NOT NULL,
  rule text NOT NULL,
  category text NOT NULL CHECK (category IN ('Crew', 'Jobs', 'Fleet', 'Finance')),
  severity text NOT NULL CHECK (severity IN ('critical', 'warning', 'info')),
  entity_type text NOT NULL,
  entity_id text NOT NULL,
  entity_label text,
  title text NOT NULL,
  description text NOT NULL,
  source text NOT NULL,
  source_observed_at timestamptz NOT NULL,
  status text NOT NULL CHECK (status IN ('open', 'acknowledged', 'in_progress', 'snoozed', 'resolved', 'dismissed')),
  owner_actor_id text REFERENCES opscenter_kernel.actors(id) ON DELETE SET NULL,
  due_at timestamptz,
  snoozed_until timestamptz,
  resolution_code text,
  resolution_note text,
  first_detected_at timestamptz NOT NULL,
  last_detected_at timestamptz NOT NULL,
  last_absent_at timestamptz,
  consecutive_fresh_absences integer NOT NULL DEFAULT 0 CHECK (consecutive_fresh_absences >= 0),
  resolved_at timestamptz,
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX work_items_active_idx
  ON opscenter_kernel.work_items (status, severity, operating_date DESC, last_detected_at DESC);
CREATE INDEX work_items_owner_idx
  ON opscenter_kernel.work_items (owner_actor_id, status, due_at);
CREATE INDEX work_items_entity_idx
  ON opscenter_kernel.work_items (entity_type, entity_id);

CREATE TABLE opscenter_kernel.action_runs (
  id text PRIMARY KEY,
  action_key text NOT NULL,
  action_version integer NOT NULL CHECK (action_version > 0),
  risk_class smallint NOT NULL CHECK (risk_class BETWEEN 0 AND 3),
  actor_id text NOT NULL REFERENCES opscenter_kernel.actors(id),
  entity_type text NOT NULL,
  entity_id text NOT NULL,
  work_item_id text REFERENCES opscenter_kernel.work_items(id) ON DELETE SET NULL,
  idempotency_key text NOT NULL,
  input_json jsonb NOT NULL,
  status text NOT NULL CHECK (status IN ('requested', 'awaiting_approval', 'denied', 'queued', 'running', 'verifying', 'succeeded', 'failed', 'cancelled')),
  policy_decision_json jsonb NOT NULL,
  requested_at timestamptz NOT NULL,
  approved_at timestamptz,
  started_at timestamptz,
  finished_at timestamptz,
  verification_json jsonb,
  sanitized_error text,
  correlation_id text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (action_key, idempotency_key)
);

CREATE INDEX action_runs_work_item_idx
  ON opscenter_kernel.action_runs (work_item_id, requested_at DESC);
CREATE INDEX action_runs_queue_idx
  ON opscenter_kernel.action_runs (status, requested_at)
  WHERE status IN ('queued', 'running', 'verifying', 'failed');
CREATE INDEX action_runs_correlation_idx
  ON opscenter_kernel.action_runs (correlation_id);

CREATE TABLE opscenter_kernel.approvals (
  id text PRIMARY KEY,
  action_run_id text NOT NULL REFERENCES opscenter_kernel.action_runs(id) ON DELETE CASCADE,
  requested_from_role text NOT NULL,
  decision text NOT NULL CHECK (decision IN ('pending', 'approved', 'denied')),
  decided_by_actor_id text REFERENCES opscenter_kernel.actors(id),
  reason text,
  requested_at timestamptz NOT NULL,
  decided_at timestamptz
);

CREATE INDEX approvals_pending_idx
  ON opscenter_kernel.approvals (decision, requested_at)
  WHERE decision = 'pending';

CREATE TABLE opscenter_kernel.events (
  id text PRIMARY KEY,
  event_type text NOT NULL,
  event_version integer NOT NULL CHECK (event_version > 0),
  aggregate_type text NOT NULL,
  aggregate_id text NOT NULL,
  actor_id text REFERENCES opscenter_kernel.actors(id) ON DELETE SET NULL,
  occurred_at timestamptz NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT now(),
  correlation_id text NOT NULL,
  causation_id text,
  payload_json jsonb NOT NULL,
  UNIQUE (aggregate_type, aggregate_id, id)
);

CREATE INDEX events_aggregate_idx
  ON opscenter_kernel.events (aggregate_type, aggregate_id, recorded_at, id);
CREATE INDEX events_correlation_idx
  ON opscenter_kernel.events (correlation_id, recorded_at);

CREATE TABLE opscenter_kernel.outbox (
  id text PRIMARY KEY,
  topic text NOT NULL,
  payload_json jsonb NOT NULL,
  available_at timestamptz NOT NULL DEFAULT now(),
  attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  locked_at timestamptz,
  completed_at timestamptz,
  sanitized_error text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX outbox_available_idx
  ON opscenter_kernel.outbox (available_at, created_at)
  WHERE completed_at IS NULL;

CREATE TABLE opscenter_kernel.detector_runs (
  id text PRIMARY KEY,
  detector_key text NOT NULL,
  operating_date date NOT NULL,
  source_observed_at timestamptz,
  source_fresh boolean NOT NULL,
  status text NOT NULL CHECK (status IN ('running', 'succeeded', 'failed')),
  detected_count integer,
  started_at timestamptz NOT NULL,
  finished_at timestamptz,
  sanitized_error text
);

CREATE INDEX detector_runs_latest_idx
  ON opscenter_kernel.detector_runs (detector_key, operating_date, started_at DESC);
