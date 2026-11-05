-- what the Runs page lists, kept in columns of their own: the list never reads record, progress or definition (big
-- jsonb: reading one field of them reads all of it). Filled when a run is queued (flow_name, started_by,
-- parent_node_label, batch_size), as it goes (envelopes_in) and when it ends (error, envelopes_in, envelopes_out).
ALTER TABLE runs ADD COLUMN flow_name text;
ALTER TABLE runs ADD COLUMN started_by text;
ALTER TABLE runs ADD COLUMN parent_node_label text;
ALTER TABLE runs ADD COLUMN batch_size int;
ALTER TABLE runs ADD COLUMN error text;
ALTER TABLE runs ADD COLUMN envelopes_in bigint;
ALTER TABLE runs ADD COLUMN envelopes_out bigint;
ALTER TABLE test_runs ADD COLUMN flow_name text;
ALTER TABLE test_runs ADD COLUMN started_by text;
ALTER TABLE test_runs ADD COLUMN parent_node_label text;
ALTER TABLE test_runs ADD COLUMN batch_size int;
ALTER TABLE test_runs ADD COLUMN error text;
ALTER TABLE test_runs ADD COLUMN envelopes_in bigint;
ALTER TABLE test_runs ADD COLUMN envelopes_out bigint;

-- the runs already there: from their record and definition, once
UPDATE runs SET
  flow_name = coalesce(record->'run'->>'flow', definition->>'name'),
  error = record->>'error',
  envelopes_in = (SELECT sum(e.value::bigint) FROM jsonb_array_elements(record->'components') c, jsonb_each_text(c->'outputs') e WHERE c->>'type' = 'start'),
  envelopes_out = (SELECT sum(e.value::bigint) FROM jsonb_array_elements(record->'components') c, jsonb_each_text(c->'inputs') e WHERE c->>'type' = 'end')
WHERE record IS NOT NULL;
UPDATE runs SET flow_name = definition->>'name' WHERE flow_name IS NULL;

-- the top runs of an organization, newest first (the list); those going on (the numbers, the sidebar); a tree by its
-- root and status (a filter keeps a top run when a run under it fits; the batches' bar)
CREATE INDEX runs_roots ON runs (org_id, queued_at DESC) WHERE parent_id IS NULL;
CREATE INDEX runs_open ON runs (org_id, status) WHERE status IN ('queued', 'running');
DROP INDEX runs_by_root;
CREATE INDEX runs_by_root ON runs (root_id, status) WHERE root_id IS NOT NULL;
