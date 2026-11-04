-- Run from here: what the run replays (the outputs of the last run that feed the part run again) and what the rest of
-- the flow did then (core's RunFromPlan); null for a run of the whole flow
ALTER TABLE runs ADD COLUMN run_from jsonb;
ALTER TABLE test_runs ADD COLUMN run_from jsonb;
