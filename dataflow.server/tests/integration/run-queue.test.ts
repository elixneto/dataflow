import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import type { RunRecord } from '@dataflow/core';
import { claimRun, deleteOldTestRuns, failRunsOf, finishRun, reapStaleRuns } from '#features/runs/run-queue';
import { openDatabase, type Database } from '#shared/database/database';

/** The queue over test_runs and runs, as the supervisors use it (PGlite: one process; several are in supervisor-postgres). */
describe('run queue', () => {
  let db: Database;
  const orgId = crypto.randomUUID();

  const queue = async (table: 'runs' | 'test_runs', values: { tag?: string; priority?: number; queuedAt?: string; user?: string } = {}) => {
    const id = crypto.randomUUID();
    const mode = table === 'runs' ? 'execution' : 'validation';
    await db.query(
      `INSERT INTO ${table} (id, org_id, flow_id, mode, draft_hash, status, trigger, worker_tag, priority, queued_at${table === 'test_runs' ? ', user_id' : ''})
       VALUES ($1, $2, $3, $4, 'h', 'queued', 'manual', $5, $6, $7${table === 'test_runs' ? ', $8' : ''})`,
      [id, orgId, crypto.randomUUID(), mode, values.tag ?? 'default', values.priority ?? 0, values.queuedAt ?? new Date().toISOString(), ...(table === 'test_runs' ? [values.user ?? 'ana'] : [])],
    );
    return id;
  };

  const record = (status: RunRecord['status']): RunRecord => ({
    run: { id: 'x', mode: 'validation', project: 'p', flow: 'f', startedAt: new Date().toISOString() },
    parameters: {},
    status,
    end: new Date().toISOString(),
    durationMs: 12,
    components: [],
  });

  beforeAll(async () => {
    db = await openDatabase('memory://');
    await db.query(`INSERT INTO organizations (id, name) VALUES ($1, 'acme')`, [orgId]);
  });

  beforeEach(async () => {
    await db.exec('DELETE FROM test_runs; DELETE FROM runs;');
  });

  afterAll(async () => {
    await db.close();
  });

  test('claims the test runs first, then by priority and age, only its tags, each run once', async () => {
    const old = await queue('runs', { queuedAt: '2026-01-01T00:00:00Z' });
    const urgent = await queue('runs', { priority: 5 });
    const test = await queue('test_runs');
    await queue('runs', { tag: 'gpu' });

    const claimed = [];
    for (let i = 0; i < 4; i++) {
      claimed.push(await claimRun(db, ['default'], 'sup-1'));
    }

    expect(claimed.map(r => r?.id ?? null)).toEqual([test, urgent, old, null]);
    expect(claimed[0]).toMatchObject({ table: 'test_runs', status: 'running', workerId: 'sup-1' });
    expect(claimed[1]?.table).toBe('runs');
    expect((await claimRun(db, ['gpu'], 'sup-2'))?.workerTag).toBe('gpu');
  });

  test('its end: the status of its record, or cancelled when Stop was asked; a run no longer there answers null', async () => {
    await queue('runs');
    await queue('runs');
    const a = (await claimRun(db, ['default'], 's'))!;
    const b = (await claimRun(db, ['default'], 's'))!;
    await db.query('UPDATE runs SET cancel_requested = true WHERE id = $1', [b.id]);

    expect(await finishRun(db, a, record('completed'), { peakRssBytes: 1024, cpuMs: 3.4 })).toBe('completed');
    expect(await finishRun(db, b, record('failed'))).toBe('cancelled');
    const [row] = await db.query<{ status: string; peak: string; cpu: string; duration: string }>(
      'SELECT status, peak_rss_bytes::text AS peak, cpu_ms::text AS cpu, duration_ms::text AS duration FROM runs WHERE id = $1',
      [a.id],
    );
    expect(row).toEqual({ status: 'completed', peak: '1024', cpu: '3', duration: '12' });
    expect(await finishRun(db, { id: crypto.randomUUID(), table: 'test_runs' }, record('completed'))).toBeNull();
  });

  test('lost runs fail with what they did so far: a stale heartbeat, or a supervisor that is gone', async () => {
    await queue('runs');
    await queue('test_runs');
    const stale = (await claimRun(db, ['default'], 'gone'))!;
    const fresh = (await claimRun(db, ['default'], 'alive'))!;
    await db.query(`UPDATE ${stale.table} SET heartbeat_at = now() - interval '5 minutes', progress = $2::text::jsonb WHERE id = $1`, [
      stale.id,
      JSON.stringify({ ...record('completed'), status: 'running', components: [{ nodeId: 'start', status: 'completed' }] }),
    ]);

    expect(await reapStaleRuns(db, 60_000)).toEqual([stale.id]);
    const [lost] = await db.query<{ status: string; record: RunRecord }>(`SELECT status, record FROM ${stale.table} WHERE id = $1`, [stale.id]);
    expect(lost?.status).toBe('failed');
    expect(lost?.record.error).toContain('stopped answering');
    expect(lost?.record.components).toHaveLength(1);

    expect(await failRunsOf(db, 'alive', 'The supervisor running it stopped.')).toEqual([fresh.id]);
    expect(await reapStaleRuns(db, 60_000)).toEqual([]);
  });

  test('test runs of more than a day ago are deleted, not one still running', async () => {
    const old = await queue('test_runs', { queuedAt: '2026-01-01T00:00:00Z', user: 'a' });
    const running = await queue('test_runs', { queuedAt: '2026-01-01T00:00:00Z', user: 'b' });
    const recent = await queue('test_runs', { user: 'c' });
    await db.query(`UPDATE test_runs SET status = 'running' WHERE id = $1`, [running]);

    expect(await deleteOldTestRuns(db)).toBe(1);
    const left = (await db.query<{ id: string }>('SELECT id FROM test_runs')).map(r => r.id).sort();
    expect(left).toEqual([running, recent].sort());
    expect(left).not.toContain(old);
  });
});
