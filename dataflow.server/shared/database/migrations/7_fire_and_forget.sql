-- a Flow Invoker's fire and forget call in a real run: the called flow queued as a run of its own. Who queued it
-- (parent_id, already there), the run at the top of its calls (root_id: a run's history finds all it started by it),
-- the Flow Invoker that called it (parent_node_id) and the flows called down to it (call_chain: {"flows": [ids],
-- "rootName"}: circular calls and depth are still checked in the run it starts)
ALTER TABLE runs ADD COLUMN root_id uuid;
ALTER TABLE runs ADD COLUMN parent_node_id text;
ALTER TABLE runs ADD COLUMN call_chain jsonb;
ALTER TABLE test_runs ADD COLUMN root_id uuid;
ALTER TABLE test_runs ADD COLUMN parent_node_id text;
ALTER TABLE test_runs ADD COLUMN call_chain jsonb;

ALTER TABLE runs DROP CONSTRAINT runs_trigger_check;
ALTER TABLE runs ADD CONSTRAINT runs_trigger_check CHECK (trigger IN ('manual', 'webhook', 'schedule', 'api', 'flow-invoker'));

CREATE INDEX runs_by_parent ON runs (parent_id) WHERE parent_id IS NOT NULL;
CREATE INDEX runs_by_root ON runs (root_id) WHERE root_id IS NOT NULL;
