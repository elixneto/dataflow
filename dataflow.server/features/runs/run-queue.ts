import { getTableColumns } from 'drizzle-orm';
import type { QueueFlowRequest, RunProgress, RunRecord } from '@dataflow/core';
import type { Database } from '#shared/database/database';
import { pgJson } from '#shared/database/jsonb';
import { RUN_TABLES, runs, type Run, type RunRowStatus, type RunTable } from './run';
import type { CalledFlow } from './start-run/called-flows';

/*
 * The runs queue, in Postgres, over the two run tables (test_runs: the editor's Run; runs: Run for real and the
 * deployed versions): the api queues a run (status 'queued') and wakes the supervisors; a supervisor claims it with
 * FOR UPDATE SKIP LOCKED (two supervisors never take the same run), keeps it alive (heartbeat_at) while a worker runs
 * it, writes how it goes (progress) and its end. Every change the editor follows is announced on CHANNELS.events.
 * A run id is in one table only: the writes by id go to both (one of them has it).
 */

/** Postgres NOTIFY channels between the api and the supervisors */
export const CHANNELS = {
  /** a run was queued: payload = its worker tag */
  queued: 'runs_queued',
  /** a run changed: payload = RunEventNotice (progress, done, or a new status for the Runs page) */
  events: 'run_events',
  /** Stop was asked on a running run: payload = its id */
  cancel: 'run_cancel',
} as const;

/**
 * What a run_events NOTIFY says: `progress` (a few times a second while it runs; only the run's own followers want it),
 * `done` (it ended) and `status` (it was queued, a worker took it, it was cancelled while queued). `done` and `status`
 * carry the organization, the top run and the status, so the Runs page's stream filters them without reading a row.
 */
export type RunEventNotice = { id: string; type: 'progress' | 'done' | 'status'; orgId?: string; rootId?: string; status?: RunRowStatus };

/** a run's own envelopes: what its Start sent and what reached its End, from its record (or its progress so far) */
export function envelopeCounts(record: Pick<RunRecord, 'components'>): { envelopesIn?: number; envelopesOut?: number } {
  const sum = (type: string, side: 'inputs' | 'outputs') => {
    const component = record.components.find(c => c.type === type);
    return component ? Object.values(component[side]).reduce((n, v) => n + v, 0) : undefined;
  };
  return { envelopesIn: sum('start', 'outputs'), envelopesOut: sum('end', 'inputs') };
}

/** the notice of a run's new status (done or status), with what the Runs page's stream filters on */
const statusNotice = (type: 'done' | 'status', row: { id: string; orgId: string; rootId: string | null; status: RunRowStatus }): RunEventNotice => ({
  id: row.id,
  type,
  orgId: row.orgId,
  rootId: row.rootId ?? row.id,
  status: row.status,
});

/** a run is lost when its heartbeat is older than this (its supervisor stopped or lost the database) */
export const STALE_AFTER_MS = 60_000;

/** test runs older than this are deleted */
export const TEST_RUNS_KEPT_MS = 24 * 60 * 60_000;

/** the row as raw SQL returns it, as Drizzle would (camelCase); the columns both tables have */
const COLUMNS = Object.entries(getTableColumns(runs)).map(([key, column]) => `${column.name} AS "${key}"`).join(', ');

/** a run and the table it is in */
export type QueuedRun = Run & { table: RunTable };

/**
 * Claims the next queued run of these tags for `workerId`: the editor's test runs first (someone is waiting for them),
 * then the others; the highest priority, then the oldest.
 */
export async function claimRun(db: Database, tags: string[], workerId: string): Promise<QueuedRun | null> {
  for (const table of RUN_TABLES) {
    const [row] = await db.query<Run>(
      `UPDATE ${table} SET status = 'running', started_at = now(), heartbeat_at = now(), worker_id = $2
       WHERE id = (
         SELECT id FROM ${table} WHERE status = 'queued' AND worker_tag = ANY($1::text[])
         ORDER BY priority DESC, queued_at
         FOR UPDATE SKIP LOCKED
         LIMIT 1
       )
       RETURNING ${COLUMNS}`,
      [tags, workerId],
    );
    if (row) {
      await notifyRunEvent(db, statusNotice('status', row));
      return { ...row, table };
    }
  }

  return null;
}

/** A run by id, in whichever table it is. */
export async function findRun(db: Database, id: string, orgId?: string): Promise<QueuedRun | null> {
  for (const table of RUN_TABLES) {
    const [row] = await db.query<Run>(
      `SELECT ${COLUMNS} FROM ${table} WHERE id = $1 ${orgId ? 'AND org_id = $2' : ''}`,
      orgId ? [id, orgId] : [id],
    );
    if (row) {
      return { ...row, table };
    }
  }

  return null;
}

/** The runs a supervisor still runs are alive. */
export async function heartbeat(db: Database, runIds: string[]): Promise<void> {
  if (runIds.length > 0) {
    for (const table of RUN_TABLES) {
      await db.query(`UPDATE ${table} SET heartbeat_at = now() WHERE id = ANY($1::uuid[]) AND status = 'running'`, [runIds]);
    }
  }
}

/** The run so far, for whoever follows it; the envelopes its Start sent so far too (the Runs page's "in flight"). */
export async function saveProgress(db: Database, run: { id: string; table: RunTable }, progress: RunProgress): Promise<void> {
  await db.query(`UPDATE ${run.table} SET progress = $2::text::jsonb, envelopes_in = $3 WHERE id = $1 AND status = 'running'`, [
    run.id,
    pgJson(progress),
    envelopeCounts(progress).envelopesIn ?? null,
  ]);
  await notifyRunEvent(db, { id: run.id, type: 'progress' });
}

export type RunUsage = { startRssBytes?: number; peakRssBytes?: number; cpuMs?: number };

/**
 * The run's end: its record and status (cancelled when Stop was asked), what it used; announced once stored. Null when
 * the run is no longer there (a test run replaced by a newer one meanwhile).
 */
export async function finishRun(db: Database, run: { id: string; table: RunTable }, record: RunRecord, usage: RunUsage = {}): Promise<RunRowStatus | null> {
  const { envelopesIn, envelopesOut } = envelopeCounts(record);
  const [row] = await db.query<{ id: string; orgId: string; rootId: string | null; status: RunRowStatus }>(
    `UPDATE ${run.table} SET
       status = CASE WHEN cancel_requested THEN 'cancelled' ELSE $2 END,
       record = $3::text::jsonb, progress = NULL, finished_at = now(), duration_ms = $4,
       start_rss_bytes = $5, peak_rss_bytes = $6, cpu_ms = $7,
       error = $8, envelopes_in = $9, envelopes_out = $10
     WHERE id = $1 AND status IN ('queued', 'running')
     RETURNING id, org_id AS "orgId", root_id AS "rootId", status`,
    [
      run.id, record.status, pgJson(record), Math.round(record.durationMs),
      usage.startRssBytes ?? null, usage.peakRssBytes ?? null, usage.cpuMs === undefined ? null : Math.round(usage.cpuMs),
      record.error ?? null, envelopesIn ?? null, envelopesOut ?? null,
    ],
  );
  await notifyRunEvent(db, row ? statusNotice('done', row) : { id: run.id, type: 'done' });
  return row?.status ?? null;
}

/** fails one lost run (still running) with what it did so far; whether it was still there to fail */
async function failLost(db: Database, run: QueuedRun, error: string, stillStale?: number): Promise<boolean> {
  const record = lostRecord(run, error);
  const { envelopesIn, envelopesOut } = envelopeCounts(record);
  const values = [run.id, pgJson(record), Math.round(record.durationMs), error, envelopesIn ?? null, envelopesOut ?? null];
  const [row] = await db.query<{ id: string; orgId: string; rootId: string | null; status: RunRowStatus }>(
    `UPDATE ${run.table} SET status = 'failed', record = $2::text::jsonb, progress = NULL, finished_at = now(), duration_ms = $3,
       error = $4, envelopes_in = $5, envelopes_out = $6
     WHERE id = $1 AND status = 'running' ${stillStale === undefined ? '' : 'AND heartbeat_at < now() - make_interval(secs => $7)'}
     RETURNING id, org_id AS "orgId", root_id AS "rootId", status`,
    stillStale === undefined ? values : [...values, stillStale / 1000],
  );
  if (row) {
    await notifyRunEvent(db, statusNotice('done', row));
  }

  return Boolean(row);
}

/**
 * Runs whose heartbeat stopped (their supervisor ended or lost the database): they fail with what they did so far.
 * Any supervisor reaps them; returns their ids.
 */
export async function reapStaleRuns(db: Database, staleAfterMs = STALE_AFTER_MS): Promise<string[]> {
  const reaped: string[] = [];
  for (const table of RUN_TABLES) {
    const stale = await db.query<Run>(
      `SELECT ${COLUMNS} FROM ${table} WHERE status = 'running' AND heartbeat_at < now() - make_interval(secs => $1)`,
      [staleAfterMs / 1000],
    );
    for (const run of stale) {
      if (await failLost(db, { ...run, table }, 'The worker running it stopped answering (its supervisor stopped or lost the database).', staleAfterMs)) {
        reaped.push(run.id);
      }
    }
  }

  return reaped;
}

/** Fails the runs a supervisor that is gone still had (it ended without finishing them). */
export async function failRunsOf(db: Database, supervisorId: string, error: string): Promise<string[]> {
  const failed: string[] = [];
  for (const table of RUN_TABLES) {
    const lost = await db.query<Run>(`SELECT ${COLUMNS} FROM ${table} WHERE status = 'running' AND worker_id = $1`, [supervisorId]);
    for (const run of lost) {
      if (await failLost(db, { ...run, table }, error)) {
        failed.push(run.id);
      }
    }
  }

  return failed;
}

/** Deletes the test runs older than a day (not one still running); returns how many. */
export async function deleteOldTestRuns(db: Database, olderThanMs = TEST_RUNS_KEPT_MS): Promise<number> {
  const rows = await db.query(
    `DELETE FROM test_runs WHERE status <> 'running' AND coalesce(finished_at, queued_at) < now() - make_interval(secs => $1) RETURNING id`,
    [olderThanMs / 1000],
  );
  return rows.length;
}

/** what a run that ended without its worker did: its last progress, failed */
export function lostRecord(run: Pick<Run, 'id' | 'mode' | 'progress' | 'startedAt' | 'queuedAt'>, error: string): RunRecord {
  const progress = run.progress as RunProgress | null;
  const started = run.startedAt ?? run.queuedAt;
  if (progress) {
    return { ...progress, status: 'failed', end: new Date().toISOString(), error, durationMs: Date.now() - new Date(started).getTime() };
  }

  return {
    run: { id: run.id, mode: run.mode, project: '', flow: '', startedAt: new Date(started).toISOString() },
    parameters: {},
    status: 'failed',
    end: new Date().toISOString(),
    durationMs: Date.now() - new Date(started).getTime(),
    error,
    components: [],
  };
}

export const notifyRunEvent = (db: Database, notice: RunEventNotice) => db.notify(CHANNELS.events, JSON.stringify(notice));

/** a run's call chain as stored (call_chain): the flows called down to it, and the first one's name */
export type CallChain = { flows: string[]; rootName: string };

/**
 * A Flow Invoker's fire and forget call, from a real run: the called flow queued as a run of its own, in runs (Run
 * for real's history), with what its parent was queued with (the called flow's draft, the scripts, the flows it calls
 * in turn: one snapshot for the whole tree), its parent, its root, the Flow Invoker that called it and the chain.
 * Wakes the supervisors. Refused from a test run (those run the call beside them, never queue it).
 */
export async function queueCalledRun(db: Database, parent: QueuedRun, request: QueueFlowRequest): Promise<{ id: string; flowName: string }> {
  if (parent.table !== 'runs') {
    throw new Error('A test run does not queue the flows it calls.');
  }

  const called = ((parent.calledFlows as CalledFlow[] | null) ?? []).find(c => c.id === request.flowId);
  if (!called?.flow) {
    throw new Error(called?.unavailable ? `The flow "${called.name}" cannot be called: ${called.unavailable}` : `The called flow (${request.flowId}) was not found.`);
  }

  const id = crypto.randomUUID();
  const chain: CallChain = { flows: request.chain, rootName: request.rootName };
  await db.orm.insert(runs).values({
    id,
    orgId: parent.orgId,
    flowId: request.flowId,
    projectId: parent.projectId,
    parentId: parent.id,
    rootId: parent.rootId ?? parent.id,
    parentNodeId: request.nodeId,
    parentNodeLabel: request.nodeLabel || null,
    callChain: chain,
    flowName: called.name,
    batchSize: Array.isArray(request.input) ? request.input.length : null,
    mode: 'execution',
    draftHash: new Bun.CryptoHasher('sha256').update(JSON.stringify(called.flow)).digest('hex'),
    status: 'queued',
    trigger: 'flow-invoker',
    workerTag: parent.workerTag,
    priority: parent.priority,
    parameters: request.parameters,
    ...(request.input !== undefined ? { input: request.input } : {}),
    definition: called.flow,
    scripts: parent.scripts,
    calledFlows: parent.calledFlows,
  });
  await notifyRunEvent(db, { id, type: 'status', orgId: parent.orgId, rootId: parent.rootId ?? parent.id, status: 'queued' });
  await db.notify(CHANNELS.queued, parent.workerTag);
  return { id, flowName: called.name };
}

/** a run as a list shows it: the runs a run queued (its fire and forget calls), each with how it goes now */
export type CalledRunView = {
  id: string;
  flowId: string;
  flow: string;
  status: RunRowStatus;
  parentNodeId: string | null;
  queuedAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  durationMs: number | null;
  error: string | null;
};

/** The runs a run queued (its Flow Invokers' fire and forget calls), in the order they were queued. */
export async function calledRunsOf(db: Database, parentId: string, orgId: string): Promise<CalledRunView[]> {
  const rows = await db.query<{
    id: string; flowId: string; flow: string | null; status: RunRowStatus; parentNodeId: string | null;
    queuedAt: Date | string; startedAt: Date | string | null; finishedAt: Date | string | null; durationMs: number | string | null; error: string | null;
  }>(
    `SELECT id, flow_id AS "flowId", coalesce(record->'run'->>'flow', definition->>'name') AS flow, status, parent_node_id AS "parentNodeId",
            queued_at AS "queuedAt", started_at AS "startedAt", finished_at AS "finishedAt", duration_ms AS "durationMs", record->>'error' AS error
     FROM runs WHERE parent_id = $1 AND org_id = $2 ORDER BY queued_at, id`,
    [parentId, orgId],
  );
  const iso = (value: Date | string | null) => (value === null ? null : new Date(value).toISOString());
  return rows.map(r => ({
    ...r,
    flow: r.flow ?? '',
    queuedAt: iso(r.queuedAt)!,
    startedAt: iso(r.startedAt),
    finishedAt: iso(r.finishedAt),
    durationMs: r.durationMs === null ? null : Number(r.durationMs),
  }));
}
