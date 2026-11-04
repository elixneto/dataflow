import { getTableColumns } from 'drizzle-orm';
import type { RunProgress, RunRecord } from '@dataflow/core';
import type { Database } from '#shared/database/database';
import { RUN_TABLES, runs, type Run, type RunRowStatus, type RunTable } from './run';

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
  /** a run changed (progress or done): payload = {"id","type"} */
  events: 'run_events',
  /** Stop was asked on a running run: payload = its id */
  cancel: 'run_cancel',
} as const;

export type RunEventNotice = { id: string; type: 'progress' | 'done' };

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

/** The run so far, for whoever follows it. */
export async function saveProgress(db: Database, run: { id: string; table: RunTable }, progress: RunProgress): Promise<void> {
  await db.query(`UPDATE ${run.table} SET progress = $2::text::jsonb WHERE id = $1 AND status = 'running'`, [run.id, JSON.stringify(progress)]);
  await notifyRunEvent(db, { id: run.id, type: 'progress' });
}

export type RunUsage = { startRssBytes?: number; peakRssBytes?: number; cpuMs?: number };

/**
 * The run's end: its record and status (cancelled when Stop was asked), what it used; announced once stored. Null when
 * the run is no longer there (a test run replaced by a newer one meanwhile).
 */
export async function finishRun(db: Database, run: { id: string; table: RunTable }, record: RunRecord, usage: RunUsage = {}): Promise<RunRowStatus | null> {
  const [row] = await db.query<{ status: RunRowStatus }>(
    `UPDATE ${run.table} SET
       status = CASE WHEN cancel_requested THEN 'cancelled' ELSE $2 END,
       record = $3::text::jsonb, progress = NULL, finished_at = now(), duration_ms = $4,
       start_rss_bytes = $5, peak_rss_bytes = $6, cpu_ms = $7
     WHERE id = $1 AND status IN ('queued', 'running')
     RETURNING status`,
    [run.id, record.status, JSON.stringify(record), Math.round(record.durationMs), usage.startRssBytes ?? null, usage.peakRssBytes ?? null, usage.cpuMs === undefined ? null : Math.round(usage.cpuMs)],
  );
  await notifyRunEvent(db, { id: run.id, type: 'done' });
  return row?.status ?? null;
}

/** fails one lost run (still running) with what it did so far; whether it was still there to fail */
async function failLost(db: Database, run: QueuedRun, error: string, stillStale?: number): Promise<boolean> {
  const record = lostRecord(run, error);
  const [row] = await db.query<{ id: string }>(
    `UPDATE ${run.table} SET status = 'failed', record = $2::text::jsonb, progress = NULL, finished_at = now(), duration_ms = $3
     WHERE id = $1 AND status = 'running' ${stillStale === undefined ? '' : 'AND heartbeat_at < now() - make_interval(secs => $4)'}
     RETURNING id`,
    stillStale === undefined ? [run.id, JSON.stringify(record), Math.round(record.durationMs)] : [run.id, JSON.stringify(record), Math.round(record.durationMs), stillStale / 1000],
  );
  if (row) {
    await notifyRunEvent(db, { id: run.id, type: 'done' });
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
