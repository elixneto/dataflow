import { z } from 'zod';
import { isFolderVisible, type RunRecord } from '@dataflow/core';
import { FlowRepository, loadTree } from '#features/folders/project-tree';
import type { UseCaseContext } from '#shared/use-cases/use-case-context';
import type { UseCaseHandler } from '#shared/use-cases/use-case-handler';
import { fail, success, type UseCaseResult } from '#shared/use-cases/use-case-result';
import { validate } from '#shared/use-cases/validate';
import type { RunUsageView } from '../get-run/get-run-handler';
import { usageOf } from '../run-events';

export const LastRunQuery = z.object({ id: z.uuid('Invalid') });

/** the flow's latest run that ended (its record) and the user's latest full test run (what Run from here starts from) */
export type LastRunView = {
  last: { id: string; mode: 'validation' | 'execution'; finishedAt: string; record: RunRecord; usage: RunUsageView | null } | null;
  full: RunRecord | null;
};

type Row = { id: string; mode: 'validation' | 'execution'; finished_at: Date; record: RunRecord; start_rss_bytes: unknown; peak_rss_bytes: unknown; cpu_ms: unknown };

const ENDED = `record IS NOT NULL AND status NOT IN ('queued', 'running') AND finished_at IS NOT NULL`;

/**
 * What the editor shows of a flow when it opens, before any run of its own: the latest of the user's test runs (a full
 * one or a Run from here) and the flow's latest Run for real, whichever ended last, and the user's latest full test
 * run. The records are as the runs kept them (secrets already hidden by the engine).
 */
export class LastRunHandler implements UseCaseHandler<LastRunView> {
  async handle(input: unknown, ctx: UseCaseContext): Promise<UseCaseResult<LastRunView>> {
    const parsed = validate(LastRunQuery, input);
    if (!parsed.ok) {
      return parsed;
    }

    const flowId = parsed.value.id;
    const row = await new FlowRepository(ctx.db, ctx.orgId).findById(flowId);
    const tree = row ? await loadTree(ctx.db, ctx.orgId, row.projectId) : null;
    if (!row || !tree || !isFolderVisible(tree.folders, row.folderId)) {
      return fail('not-found', 'Flow not found.');
    }

    const columns = 'id, mode, finished_at, record, start_rss_bytes, peak_rss_bytes, cpu_ms';
    const [test] = await ctx.db.query<Row>(
      `SELECT ${columns} FROM test_runs WHERE org_id = $1 AND flow_id = $2 AND user_id = $3 AND ${ENDED} ORDER BY finished_at DESC LIMIT 1`,
      [ctx.orgId, flowId, ctx.userId],
    );
    const [real] = await ctx.db.query<Row>(`SELECT ${columns} FROM runs WHERE org_id = $1 AND flow_id = $2 AND mode = 'execution' AND ${ENDED} ORDER BY finished_at DESC LIMIT 1`, [
      ctx.orgId,
      flowId,
    ]);
    const [full] = await ctx.db.query<{ record: RunRecord }>(
      `SELECT record FROM test_runs WHERE org_id = $1 AND flow_id = $2 AND user_id = $3 AND run_from IS NULL AND ${ENDED}`,
      [ctx.orgId, flowId, ctx.userId],
    );

    const latest = [test, real].filter((r): r is Row => !!r).sort((a, b) => new Date(b.finished_at).getTime() - new Date(a.finished_at).getTime())[0];
    return success({
      last: latest
        ? {
            id: latest.id,
            mode: latest.mode,
            finishedAt: new Date(latest.finished_at).toISOString(),
            record: latest.record,
            usage: usageOf({ startRssBytes: latest.start_rss_bytes, peakRssBytes: latest.peak_rss_bytes, cpuMs: latest.cpu_ms }),
          }
        : null,
      full: full?.record ?? null,
    });
  }
}
