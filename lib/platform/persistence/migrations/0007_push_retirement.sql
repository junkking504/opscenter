-- Prepared locally only; no production migration authorized.
ALTER TABLE opscenter_kernel.push_events ADD COLUMN source_scope text;
CREATE INDEX push_events_scope ON opscenter_kernel.push_events(source_scope);
CREATE TABLE opscenter_kernel.push_retention (
 singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton),
 retired_before date NOT NULL
);
