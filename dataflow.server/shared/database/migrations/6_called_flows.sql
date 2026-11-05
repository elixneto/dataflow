-- the flows a run's Flow Invokers call (and those call), as they were when it was queued: each one's draft, the
-- Start's input type read from its script, or why it cannot be called
ALTER TABLE runs ADD COLUMN called_flows jsonb;
ALTER TABLE test_runs ADD COLUMN called_flows jsonb;
