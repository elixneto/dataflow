import { bigint, boolean, integer, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { jsonb } from '#shared/database/jsonb';
import { organizations } from '#features/organizations/organization';
import { projects } from '#features/projects/project';

/** the columns of both run tables (a function: each table needs its own column builders) */
const runColumns = () => ({
  id: uuid('id').primaryKey(),
  orgId: uuid('org_id').notNull().references(() => organizations.id),
  flowId: uuid('flow_id').notNull(),
  projectId: uuid('project_id').references(() => projects.id),
  parentId: uuid('parent_id'),
  mode: text('mode').$type<'execution' | 'validation'>().notNull(),
  flowVersionId: uuid('flow_version_id'),
  draftHash: text('draft_hash'),
  status: text('status').$type<RunRowStatus>().notNull(),
  trigger: text('trigger').$type<'manual' | 'webhook' | 'schedule' | 'api'>().notNull(),
  workerTag: text('worker_tag').notNull().default('default'),
  priority: integer('priority').notNull().default(0),
  parameters: jsonb('parameters'),
  input: jsonb('input'),
  queuedAt: timestamp('queued_at', { withTimezone: true }).notNull().defaultNow(),
  startedAt: timestamp('started_at', { withTimezone: true }),
  finishedAt: timestamp('finished_at', { withTimezone: true }),
  workerId: text('worker_id'),
  heartbeatAt: timestamp('heartbeat_at', { withTimezone: true }),
  cancelRequested: boolean('cancel_requested').notNull().default(false),
  startRssBytes: bigint('start_rss_bytes', { mode: 'number' }),
  peakRssBytes: bigint('peak_rss_bytes', { mode: 'number' }),
  cpuMs: bigint('cpu_ms', { mode: 'number' }),
  durationMs: bigint('duration_ms', { mode: 'number' }),
  record: jsonb('record'),
  /** the FlowFile run, as it was when queued */
  definition: jsonb('definition'),
  /** the run so far (RunProgress) while it goes on, written by the supervisor a few times a second */
  progress: jsonb('progress'),
  /** Run from here: the core's RunFromPlan (3_run_from.sql); null for a run of the whole flow */
  runFrom: jsonb('run_from'),
  /** the project's scripts as they were when queued, {path: code} (5_scripts.sql) */
  scripts: jsonb('scripts'),
});

/**
 * Follows migrations/1_initial.sql to 5_scripts.sql: a real run (Run for real, a deployed version), queued,
 * running or done, kept with its history. The editor's Run for real runs the flow's draft (draft_hash); a published
 * run, a deployed version (flow_version_id). `record` is the core's RunRecord.
 */
export const runs = pgTable('runs', runColumns());

/** The editor's test runs (validation): the same columns, only the latest per flow and user, none older than a day. */
export const testRuns = pgTable('test_runs', { ...runColumns(), userId: text('user_id').notNull() });

/** the two tables a run may be in; a run id is in one of them only */
export const RUN_TABLES = ['test_runs', 'runs'] as const;
export type RunTable = (typeof RUN_TABLES)[number];

export type RunRowStatus = 'queued' | 'running' | 'completed' | 'with-warnings' | 'with-errors' | 'failed' | 'cancelled';

export type Run = typeof runs.$inferSelect;
