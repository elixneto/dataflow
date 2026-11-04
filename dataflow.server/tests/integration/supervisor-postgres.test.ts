import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from 'bun:test';
import { eq } from 'drizzle-orm';
import { fileURLToPath } from 'node:url';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { newFlowFile, type FlowFile, type RunRecord } from '@dataflow/core';
import { CancelRunHandler } from '#features/runs/cancel-run/cancel-run-handler';
import { followRunEvents, runEvents, type RunEvent } from '#features/runs/run-events';
import { runs } from '#features/runs/run';
import { CHANNELS } from '#features/runs/run-queue';
import { openDatabase, type Database } from '#shared/database/database';

setDefaultTimeout(60_000);

/*
 * Supervisors as they run in production: separate processes (supervisor/main.ts, each with its worker processes) on
 * a real Postgres, started by Testcontainers (Docker). They share the queue (SKIP LOCKED: each run runs once), wake on
 * NOTIFY, publish progress to the api's process, stop a run another process asked to stop, and a supervisor that dies
 * leaves its runs to be failed by the next one. Skipped when Docker is not running.
 */

const container: StartedPostgreSqlContainer | null = await new PostgreSqlContainer('postgres:17.6-alpine').start().catch(() => null);
const MAIN = fileURLToPath(new URL('../../supervisor/main.ts', import.meta.url));

describe.skipIf(!container)('supervisors on Postgres (separate processes)', () => {
  let db: Database;
  let server: ReturnType<typeof Bun.serve>;
  let stopFollowing: () => Promise<void>;
  const hits: string[] = [];
  const supervisors: ReturnType<typeof Bun.spawn>[] = [];
  const orgId = crypto.randomUUID();
  const projectId = crypto.randomUUID();

  /** a supervisor process with `workers` workers; resolves once it says it is up (its id) */
  const startSupervisor = async (workers: number): Promise<{ child: ReturnType<typeof Bun.spawn>; id: string }> => {
    const child = Bun.spawn(['bun', MAIN], {
      env: { ...process.env, DATABASE_URL: container!.getConnectionUri(), WORKERS: String(workers), WORKER_TAGS: 'default', ENVIRONMENT: 'DEV', SECRETS_KEYS: `t:${Buffer.alloc(32, 9).toString('base64')}` },
      stdout: 'pipe',
      stderr: 'inherit',
    });
    supervisors.push(child);
    const reader = child.stdout.pipeThrough(new TextDecoderStream()).getReader();
    let text = '';
    for (;;) {
      const { value, done } = await reader.read();
      if (done) {
        throw new Error(`the supervisor ended: ${text}`);
      }

      text += value;
      const id = /supervisor (\S+):/.exec(text)?.[1];
      if (id) {
        // keep reading its lines (one per run), so its output never blocks
        void (async () => {
          while (!(await reader.read()).done) {
            /* drained */
          }
        })();
        return { child, id };
      }
    }
  };

  /** a run of a flow that calls the local server (`ms` long), queued in runs */
  const queue = async (ms: number) => {
    const file = newFlowFile('Queue');
    const [start, end] = file.nodes;
    const flow: FlowFile = {
      ...file,
      nodes: [
        start!,
        { id: 'call', type: 'http-request', position: { x: 160, y: 0 }, config: { url: { value: `http://localhost:${server.port}/slow?ms=${ms}`, expression: false } } },
        end!,
      ],
      edges: [
        { source: start!.id, sourcePort: 'out-0', target: 'call', targetPort: 'in-0' },
        { source: 'call', sourcePort: 'out-0', target: end!.id, targetPort: 'in-0' },
      ],
    };
    const id = crypto.randomUUID();
    await db.query(
      `INSERT INTO runs (id, org_id, flow_id, project_id, mode, draft_hash, status, trigger, definition)
       VALUES ($1, $2, $3, $4, 'execution', 'h', 'queued', 'manual', $5::text::jsonb)`,
      [id, orgId, crypto.randomUUID(), projectId, JSON.stringify(flow)],
    );
    await db.notify(CHANNELS.queued, 'default');
    return id;
  };

  const statusOf = async (id: string) => (await db.query<{ status: string; worker_id: string; record: RunRecord | null }>('SELECT status, worker_id, record FROM runs WHERE id = $1', [id]))[0]!;

  const until = async (check: () => Promise<boolean>, timeoutMs = 30_000) => {
    const deadline = Date.now() + timeoutMs;
    while (!(await check())) {
      if (Date.now() > deadline) {
        throw new Error('timed out');
      }

      await Bun.sleep(50);
    }
  };

  beforeAll(async () => {
    server = Bun.serve({
      port: 0,
      async fetch(request) {
        const url = new URL(request.url);
        hits.push(url.search);
        await Bun.sleep(Number(url.searchParams.get('ms') ?? 0));
        return Response.json({ ok: true });
      },
    });
    db = await openDatabase(container!.getConnectionUri());
    await db.query(`INSERT INTO organizations (id, name) VALUES ($1, 'acme')`, [orgId]);
    await db.query(`INSERT INTO projects (id, org_id, name, description) VALUES ($1, $2, 'Queue', '')`, [projectId, orgId]);
    stopFollowing = await followRunEvents(db);
  });

  afterAll(async () => {
    for (const child of supervisors) {
      child.kill();
    }

    await Promise.all(supervisors.map(child => child.exited));
    await stopFollowing?.();
    await db?.close();
    server?.stop(true);
    await container?.stop();
  });

  test('jsonb written through Drizzle keeps objects and arrays (Bun encodes it once, not twice)', async () => {
    const id = crypto.randomUUID();
    await db.orm.insert(runs).values({
      id,
      orgId,
      flowId: crypto.randomUUID(),
      mode: 'execution',
      draftHash: 'h',
      status: 'completed',
      trigger: 'manual',
      parameters: { region: 'eu' },
      definition: { nodes: [{ id: 'start' }], edges: [] },
      record: null,
    });
    const [row] = await db.query<{ p: string; d: string; nodes: string }>(
      `SELECT jsonb_typeof(parameters) AS p, jsonb_typeof(definition) AS d, jsonb_typeof(definition->'nodes') AS nodes FROM runs WHERE id = $1`,
      [id],
    );
    expect(row).toEqual({ p: 'object', d: 'object', nodes: 'array' });
    const [back] = await db.orm.select({ definition: runs.definition }).from(runs).where(eq(runs.id, id));
    expect(back?.definition).toEqual({ nodes: [{ id: 'start' }], edges: [] });
    await db.query('DELETE FROM runs WHERE id = $1', [id]);
  });

  test('two supervisors share the queue: every run runs once, both take some; the api follows a run they run', async () => {
    const [a, b] = await Promise.all([startSupervisor(2), startSupervisor(2)]);
    const before = hits.length;
    const ids: string[] = [];
    for (let i = 0; i < 8; i++) {
      ids.push(await queue(400));
    }

    // followed from this process (the api's place), run in another
    const events: RunEvent['type'][] = [];
    runEvents.subscribe(ids[7]!, event => events.push(event.type));

    await until(async () => (await Promise.all(ids.map(statusOf))).every(r => r.status === 'completed'));
    const rows = await Promise.all(ids.map(statusOf));
    expect(hits.length - before).toBe(8);
    expect(new Set(rows.map(r => r.worker_id))).toEqual(new Set([a.id, b.id]));
    expect(events).toContain('progress');
    expect(events.at(-1)).toBe('done');
    const [usage] = await db.query<{ peak: string }>('SELECT peak_rss_bytes::text AS peak FROM runs WHERE id = $1', [ids[0]]);
    expect(Number(usage?.peak)).toBeGreaterThan(0);
  });

  test('Stop from another process: the supervisor running it stops it; it ends cancelled', async () => {
    const id = await queue(10_000);
    await until(async () => (await statusOf(id)).status === 'running' && hits.some(h => h === '?ms=10000'));
    const result = await new CancelRunHandler().handle({ id }, { db, orgId, userId: 'ana' });
    expect(result.ok && result.value.status).toBe('running');
    await until(async () => (await statusOf(id)).status === 'cancelled', 15_000);
    expect((await statusOf(id)).record?.error).toContain('cancelled');
  });

  test('a supervisor killed with a run going on: the next supervisor of the host fails that run at once', async () => {
    for (const child of supervisors.splice(0)) {
      child.kill();
      await child.exited;
    }

    const lone = await startSupervisor(1);
    const id = await queue(10_000);
    await until(async () => (await statusOf(id)).worker_id === lone.id);
    // killed without a chance to end its runs (as Ctrl+C or a crash)
    lone.child.kill(9);
    await lone.child.exited;
    expect((await statusOf(id)).status).toBe('running');

    await startSupervisor(1);
    await until(async () => (await statusOf(id)).status === 'failed', 15_000);
    expect((await statusOf(id)).record?.error).toContain('supervisor');
  });
});
