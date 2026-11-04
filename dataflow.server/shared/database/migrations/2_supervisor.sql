-- the supervisor runs what the api queues: a run carries what it runs (the draft as it was when queued, so editing
-- the flow afterwards changes nothing in it), its project, and the run so far while it goes on (the editor follows it)
ALTER TABLE runs ADD COLUMN project_id uuid REFERENCES projects;
ALTER TABLE runs ADD COLUMN definition jsonb;
ALTER TABLE runs ADD COLUMN progress jsonb;

-- test runs (the editor's Run, mode validation) are scratch: UNLOGGED (no WAL; emptied if Postgres crashes), only the
-- latest per flow and user (a new one replaces it), and none older than a day (the supervisor deletes them). The same
-- columns as runs, so the supervisor claims and runs both alike. `runs` keeps the real runs (execution), with history.
DELETE FROM runs WHERE mode = 'validation';
CREATE UNLOGGED TABLE test_runs (LIKE runs INCLUDING DEFAULTS INCLUDING CONSTRAINTS);
ALTER TABLE test_runs ADD PRIMARY KEY (id);
ALTER TABLE test_runs ADD FOREIGN KEY (org_id) REFERENCES organizations;
ALTER TABLE test_runs ADD FOREIGN KEY (project_id) REFERENCES projects;
ALTER TABLE test_runs ADD COLUMN user_id text NOT NULL;
ALTER TABLE test_runs ADD CONSTRAINT test_runs_validation CHECK (mode = 'validation');
CREATE UNIQUE INDEX test_runs_latest ON test_runs (org_id, flow_id, user_id);
CREATE INDEX test_runs_queue ON test_runs (worker_tag, priority, queued_at) WHERE status = 'queued';
CREATE INDEX test_runs_running ON test_runs (heartbeat_at) WHERE status = 'running';
CREATE INDEX test_runs_age ON test_runs (queued_at);
