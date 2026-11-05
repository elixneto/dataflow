import { z } from 'zod';
import type { RunProgress, RunRecord } from '@dataflow/core';
import type { UseCaseContext } from '#shared/use-cases/use-case-context';
import type { UseCaseHandler } from '#shared/use-cases/use-case-handler';
import { fail, success, type UseCaseResult } from '#shared/use-cases/use-case-result';
import { validate } from '#shared/use-cases/validate';
import type { Run, RunRowStatus } from '../run';
import { usageOf } from '../run-events';
import { calledRunsOf, findRun, type CalledRunView } from '../run-queue';

export const GetRunQuery = z.object({ id: z.uuid('Invalid') });

/** queued: no record yet; while it runs, `record` is the run so far (each component as it ended or running); once it ended, the record */
export type RunView = {
  id: string;
  flowId: string;
  /** the flow's name when it was queued, its project, what started it and when (the run's logs page heads with them) */
  flowName: string | null;
  projectId: string | null;
  trigger: Run['trigger'];
  queuedAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  mode: 'validation' | 'execution';
  status: RunRowStatus;
  record: RunRecord | RunProgress | null;
  /** what its worker process used, once it ended: memory at the start and its peak (the whole process), CPU */
  usage: RunUsageView | null;
  /** a run a Flow Invoker's fire and forget call queued: the run that queued it, the one at the top, the Flow Invoker */
  parentId: string | null;
  rootId: string | null;
  parentNodeId: string | null;
  /** the runs it queued (its fire and forget calls), each with how it goes now: its own status, apart from this one's */
  calledRuns: CalledRunView[];
};

export type RunUsageView = { startRssBytes: number | null; peakRssBytes: number | null; cpuMs: number | null };

/** raw SQL may give a timestamp as a Date or a string */
const iso = (value: Date | string | null): string | null => (value === null ? null : new Date(value).toISOString());


/** A run as the editor follows it (a test run or a real one): its status, and its record (so far while it runs). */
export class GetRunHandler implements UseCaseHandler<RunView> {
  async handle(input: unknown, ctx: UseCaseContext): Promise<UseCaseResult<RunView>> {
    const parsed = validate(GetRunQuery, input);
    if (!parsed.ok) {
      return parsed;
    }

    const run = await findRun(ctx.db, parsed.value.id, ctx.orgId);
    if (!run) {
      return fail('not-found', 'Run not found.');
    }

    // while it runs, what the supervisor last wrote of it
    const live = run.status === 'running' ? (run.progress as RunProgress | null) : null;
    return success({
      id: run.id,
      flowId: run.flowId,
      flowName: run.flowName,
      projectId: run.projectId,
      trigger: run.trigger,
      queuedAt: iso(run.queuedAt)!,
      startedAt: iso(run.startedAt),
      finishedAt: iso(run.finishedAt),
      mode: run.mode,
      status: run.status,
      record: live ?? (run.record as RunRecord | null) ?? null,
      usage: usageOf(run),
      parentId: run.parentId,
      rootId: run.rootId,
      parentNodeId: run.parentNodeId,
      calledRuns: run.table === 'runs' ? await calledRunsOf(ctx.db, run.id, ctx.orgId) : [],
    });
  }
}
