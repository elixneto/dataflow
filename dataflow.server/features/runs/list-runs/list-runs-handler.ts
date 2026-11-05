import { z } from 'zod';
import type { Database } from '#shared/database/database';
import type { UseCaseContext } from '#shared/use-cases/use-case-context';
import type { UseCaseHandler } from '#shared/use-cases/use-case-handler';
import { fail, success, type UseCaseResult } from '#shared/use-cases/use-case-result';
import { validate } from '#shared/use-cases/validate';
import type { RunRowStatus } from '../run';

/*
 * The Runs page (GET /runs, /runs/overview, /runs/:id/tree): the organization's runs for real (the runs table: test
 * runs are the editor's), each top run with the tree of the runs it queued (fire and forget). Only the columns of
 * 8_runs_list.sql and the times: never record, progress or definition (big jsonb).
 */

/** a run as the Runs page lists it */
export type RunListItem = {
  id: string;
  status: RunRowStatus;
  trigger: string;
  projectId: string | null;
  projectName: string | null;
  flowId: string;
  flowName: string | null;
  /** who started it (Run for real): the user's name, or the id when it is not a user */
  startedBy: string | null;
  queuedAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  durationMs: number | null;
  envelopesIn: number | null;
  envelopesOut: number | null;
  error: string | null;
  workerId: string | null;
  parentId: string | null;
  rootId: string | null;
  /** the Flow Invoker that queued it, and how many envelopes its batch took */
  calledBy: string | null;
  batchSize: number | null;
};

/** the most runs of one tree a page answers (a fire and forget of many batches): the first ones, in the order queued */
export const TREE_LIMIT = 200;

const SELECT = `
  SELECT r.id, r.status, r.trigger, r.project_id AS "projectId", p.name AS "projectName", r.flow_id AS "flowId",
         r.flow_name AS "flowName", coalesce(u.name, r.started_by) AS "startedBy", r.queued_at AS "queuedAt",
         r.started_at AS "startedAt", r.finished_at AS "finishedAt", r.duration_ms AS "durationMs",
         r.envelopes_in AS "envelopesIn", r.envelopes_out AS "envelopesOut", r.error, r.worker_id AS "workerId",
         r.parent_id AS "parentId", r.root_id AS "rootId", r.parent_node_label AS "calledBy", r.batch_size AS "batchSize"
  FROM runs r
  LEFT JOIN projects p ON p.id = r.project_id
  LEFT JOIN users u ON u.org_id = r.org_id AND u.id::text = r.started_by`;

type Row = Omit<RunListItem, 'queuedAt' | 'startedAt' | 'finishedAt' | 'durationMs' | 'envelopesIn' | 'envelopesOut' | 'batchSize'> & {
  queuedAt: Date | string;
  startedAt: Date | string | null;
  finishedAt: Date | string | null;
  durationMs: number | string | null;
  envelopesIn: number | string | null;
  envelopesOut: number | string | null;
  batchSize: number | string | null;
};

const iso = (v: Date | string | null) => (v === null ? null : new Date(v).toISOString());
const num = (v: number | string | null) => (v === null ? null : Number(v));
const item = (r: Row): RunListItem => ({
  ...r,
  queuedAt: iso(r.queuedAt)!,
  startedAt: iso(r.startedAt),
  finishedAt: iso(r.finishedAt),
  durationMs: num(r.durationMs),
  envelopesIn: num(r.envelopesIn),
  envelopesOut: num(r.envelopesOut),
  batchSize: num(r.batchSize),
});

/** the runs under these top runs, the first TREE_LIMIT of each in the order queued, and how many each one has */
async function treesOf(db: Database, orgId: string, rootIds: string[]): Promise<{ runs: RunListItem[]; sizes: Map<string, number> }> {
  if (rootIds.length === 0) {
    return { runs: [], sizes: new Map() };
  }

  const rows = await db.query<Row & { n: number | string; total: number | string }>(
    `SELECT * FROM (
       ${SELECT.replace('SELECT r.id', 'SELECT row_number() OVER (PARTITION BY r.root_id ORDER BY r.queued_at, r.id) AS n, count(*) OVER (PARTITION BY r.root_id) AS total, r.id')}
       WHERE r.org_id = $1 AND r.root_id = ANY($2::uuid[])
     ) t WHERE n <= $3 ORDER BY "queuedAt", id`,
    [orgId, rootIds, TREE_LIMIT],
  );
  const sizes = new Map<string, number>();
  for (const row of rows) sizes.set(row.rootId!, Number(row.total));
  return { runs: rows.map(({ n: _n, total: _total, ...row }) => item(row)), sizes };
}

const STATUS_FILTER = ['all', 'open', 'running', 'queued', 'problems', 'completed', 'cancelled'] as const;

/** how far back the Runs page looks (its numbers, and the top runs it lists), as a Postgres interval */
const Period = z.enum(['24h', '7d']);
export const RUN_PERIODS: Record<z.infer<typeof Period>, string> = { '24h': '1 day', '7d': '7 days' };

export const ListRunsQuery = z.object({
  status: z.enum(STATUS_FILTER).default('all'),
  project: z.uuid('Invalid').optional(),
  trigger: z.enum(['manual', 'schedule', 'webhook', 'api', 'flow-invoker']).optional(),
  /** a run id (whole or its start) or part of a flow's name */
  q: z.string().trim().max(200).optional(),
  /** only the top runs queued in this period (none: any time) */
  period: Period.optional(),
  /** the next page: the top runs queued before this one (the last of the page before: its queued_at and id) */
  before: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

export type RunListPage = {
  /** the top runs of the page and the runs of their trees (the first TREE_LIMIT of each) */
  runs: RunListItem[];
  /** per top run of the page: how many runs its tree has in all */
  treeSizes: Record<string, number>;
  /** the `before` of the next page; none when this is the last */
  next: string | null;
};

/**
 * The top runs (queued by no other run) of the organization, newest first, a page at a time, each with its tree. A
 * filter (status, project, trigger, search) keeps a top run when it or a run of its tree fits: a run that completed
 * while one it queued still runs shows under "running".
 */
export class ListRunsHandler implements UseCaseHandler<RunListPage> {
  async handle(input: unknown, ctx: UseCaseContext): Promise<UseCaseResult<RunListPage>> {
    const parsed = validate(ListRunsQuery, input);
    if (!parsed.ok) {
      return parsed;
    }

    const { status, project, trigger, q, period, before, limit } = parsed.value;
    const values: unknown[] = [ctx.orgId];
    const param = (value: unknown) => {
      values.push(value);
      return `$${values.length}`;
    };
    // what one run (x) must be to fit; the top run fits when it or a run of its tree does
    const fits: string[] = [];
    if (status === 'open') fits.push(`x.status IN ('queued', 'running')`);
    else if (status === 'problems') fits.push(`x.status IN ('failed', 'with-errors')`);
    else if (status !== 'all') fits.push(`x.status = ${param(status)}`);
    if (project) fits.push(`x.project_id = ${param(project)}`);
    if (trigger) fits.push(`x.trigger = ${param(trigger)}`);
    if (q) {
      const term = param(q.toLowerCase());
      fits.push(`(x.id::text LIKE ${term} || '%' OR lower(x.flow_name) LIKE '%' || ${term} || '%')`);
    }

    const where = ['r.org_id = $1', 'r.parent_id IS NULL'];
    if (period) where.push(`r.queued_at > now() - ${param(RUN_PERIODS[period])}::interval`);
    if (fits.length) {
      const one = fits.join(' AND ');
      where.push(`(${one.replaceAll('x.', 'r.')} OR EXISTS (SELECT 1 FROM runs x WHERE x.root_id = r.id AND ${one}))`);
    }

    if (before) {
      const [at, id] = before.split('|');
      if (!at || !id || Number.isNaN(Date.parse(at))) {
        return fail('validation', 'Invalid page.');
      }

      where.push(`(r.queued_at, r.id) < (${param(at)}::timestamptz, ${param(id)}::uuid)`);
    }

    const roots = (await ctx.db.query<Row>(`${SELECT} WHERE ${where.join(' AND ')} ORDER BY r.queued_at DESC, r.id DESC LIMIT ${param(limit + 1)}`, values)).map(item);
    const page = roots.slice(0, limit);
    const last = page[page.length - 1];
    const trees = await treesOf(ctx.db, ctx.orgId, page.map(r => r.id));
    return success({
      runs: [...page, ...trees.runs],
      treeSizes: Object.fromEntries(page.map(r => [r.id, trees.sizes.get(r.id) ?? 0])),
      next: roots.length > limit && last ? `${last.queuedAt}|${last.id}` : null,
    });
  }
}

export const RunOverviewQuery = z.object({ period: Period.default('24h') });

export type RunOverview = {
  /** top runs queued in the period (the last 24 h unless asked) */
  all: number;
  running: number;
  /** the envelopes the runs going on took in so far (their Start's outputs, saved with their progress) */
  inFlight: number;
  queued: number;
  /** how long the oldest queued run has waited */
  oldestWaitMs: number;
  /** failed or with errors, ended in the period */
  problems: number;
  completed: number;
};

/** The numbers above the list: a few counts, on the partial indexes (runs_open, runs_roots). */
export class RunOverviewHandler implements UseCaseHandler<RunOverview> {
  async handle(input: unknown, ctx: UseCaseContext): Promise<UseCaseResult<RunOverview>> {
    const parsed = validate(RunOverviewQuery, input);
    if (!parsed.ok) {
      return parsed;
    }

    const [open] = await ctx.db.query<{ running: number | string; queued: number | string; inFlight: number | string | null; oldest: Date | string | null }>(
      `SELECT count(*) FILTER (WHERE status = 'running') AS running, count(*) FILTER (WHERE status = 'queued') AS queued,
              sum(envelopes_in) FILTER (WHERE status = 'running') AS "inFlight", min(queued_at) FILTER (WHERE status = 'queued') AS oldest
       FROM runs WHERE org_id = $1 AND status IN ('queued', 'running')`,
      [ctx.orgId],
    );
    const [day] = await ctx.db.query<{ all: number | string; problems: number | string; completed: number | string }>(
      `SELECT (SELECT count(*) FROM runs WHERE org_id = $1 AND parent_id IS NULL AND queued_at > now() - $2::interval) AS all,
              count(*) FILTER (WHERE status IN ('failed', 'with-errors')) AS problems, count(*) FILTER (WHERE status = 'completed') AS completed
       FROM runs WHERE org_id = $1 AND finished_at > now() - $2::interval`,
      [ctx.orgId, RUN_PERIODS[parsed.value.period]],
    );
    return success({
      all: Number(day?.all ?? 0),
      running: Number(open?.running ?? 0),
      inFlight: Number(open?.inFlight ?? 0),
      queued: Number(open?.queued ?? 0),
      oldestWaitMs: open?.oldest ? Math.max(0, Date.now() - new Date(open.oldest).getTime()) : 0,
      problems: Number(day?.problems ?? 0),
      completed: Number(day?.completed ?? 0),
    });
  }
}

export const RunTreeQuery = z.object({ id: z.uuid('Invalid') });

/** A run's whole tree (its top run and every run under it, the first TREE_LIMIT), for a link to a run not on the page. */
export class RunTreeHandler implements UseCaseHandler<Omit<RunListPage, 'next'>> {
  async handle(input: unknown, ctx: UseCaseContext): Promise<UseCaseResult<Omit<RunListPage, 'next'>>> {
    const parsed = validate(RunTreeQuery, input);
    if (!parsed.ok) {
      return parsed;
    }

    const [found] = await ctx.db.query<{ root: string }>(`SELECT coalesce(root_id, id) AS root FROM runs WHERE id = $1 AND org_id = $2`, [parsed.value.id, ctx.orgId]);
    if (!found) {
      return fail('not-found', 'Run not found.');
    }

    const [root] = (await ctx.db.query<Row>(`${SELECT} WHERE r.id = $1 AND r.org_id = $2`, [found.root, ctx.orgId])).map(item);
    if (!root) {
      return fail('not-found', 'Run not found.');
    }

    const tree = await treesOf(ctx.db, ctx.orgId, [root.id]);
    return success({ runs: [root, ...tree.runs], treeSizes: { [root.id]: tree.sizes.get(root.id) ?? 0 } });
  }
}
