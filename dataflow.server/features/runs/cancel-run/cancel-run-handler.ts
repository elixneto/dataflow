import { z } from 'zod';
import type { UseCaseContext } from '#shared/use-cases/use-case-context';
import type { UseCaseHandler } from '#shared/use-cases/use-case-handler';
import { fail, success, type UseCaseResult } from '#shared/use-cases/use-case-result';
import { validate } from '#shared/use-cases/validate';
import type { RunRowStatus } from '../run';
import { CHANNELS, findRun, lostRecord, notifyRunEvent } from '../run-queue';

export const CancelRunCommand = z.object({ id: z.uuid('Invalid') });

/**
 * Stop: a queued run is cancelled right away; a running one is marked and its supervisor told (NOTIFY), which stops it
 * and stores it as cancelled with what it did so far. A run that already ended stays as it ended. Answers its status.
 */
export class CancelRunHandler implements UseCaseHandler<{ id: string; status: RunRowStatus }> {
  async handle(input: unknown, ctx: UseCaseContext): Promise<UseCaseResult<{ id: string; status: RunRowStatus }>> {
    const parsed = validate(CancelRunCommand, input);
    if (!parsed.ok) {
      return parsed;
    }

    const { id } = parsed.value;
    const run = await findRun(ctx.db, id, ctx.orgId);
    if (!run) {
      return fail('not-found', 'Run not found.');
    }

    if (run.status === 'queued') {
      const record = { ...lostRecord({ id, mode: run.mode, progress: null, startedAt: null, queuedAt: run.queuedAt }, 'Run cancelled before it started.'), durationMs: 0 };
      const [cancelled] = await ctx.db.query<{ id: string }>(
        `UPDATE ${run.table} SET status = 'cancelled', cancel_requested = true, record = $2::text::jsonb, finished_at = now(), duration_ms = 0
         WHERE id = $1 AND status = 'queued' RETURNING id`,
        [id, JSON.stringify(record)],
      );
      if (cancelled) {
        await notifyRunEvent(ctx.db, { id, type: 'done' });
        return success({ id, status: 'cancelled' });
      }
      // a supervisor claimed it meanwhile: stopped as a running one
    }

    const [running] = await ctx.db.query<{ id: string }>(
      `UPDATE ${run.table} SET cancel_requested = true WHERE id = $1 AND status = 'running' RETURNING id`,
      [id],
    );
    if (running) {
      await ctx.db.notify(CHANNELS.cancel, id);
      return success({ id, status: 'running' });
    }

    const now = await findRun(ctx.db, id, ctx.orgId);
    return success({ id, status: now?.status ?? run.status });
  }
}
