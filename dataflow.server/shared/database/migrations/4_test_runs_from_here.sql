-- test runs: per flow and user, the latest full test run and, beside it, the latest Run from here (run_from set). A
-- Run from here takes its input from the full one and replaces only the previous Run from here.
DROP INDEX test_runs_latest;
CREATE UNIQUE INDEX test_runs_latest ON test_runs (org_id, flow_id, user_id, (run_from IS NOT NULL));
