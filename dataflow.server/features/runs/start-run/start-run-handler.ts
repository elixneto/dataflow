import { z } from 'zod';
import { isFolderVisible, planRunFrom, toExecutableFlow, validateFlowFile, type RunFromPlan, type RunRecord } from '@dataflow/core';
import type { Database } from '#shared/database/database';
import { FlowRepository, loadTree } from '#features/folders/project-tree';
import { readDraft } from '#features/flows/flow-draft';
import type { UseCaseContext } from '#shared/use-cases/use-case-context';
import type { UseCaseHandler } from '#shared/use-cases/use-case-handler';
import { fail, success, type UseCaseResult } from '#shared/use-cases/use-case-result';
import { validate } from '#shared/use-cases/validate';
import { scriptsForRun } from '#features/scripts/script-store';
import { CHANNELS, notifyRunEvent } from '../run-queue';
import { runs, testRuns } from '../run';

export const StartRunCommand = z.object({
  id: z.uuid('Invalid'),
  /** validation: a test run (what writes outside the flow does not write); execution: Run for real */
  mode: z.enum(['validation', 'execution']),
  /** the Start's parameters given by who runs it (the others take their default) */
  parameters: z.record(z.string(), z.string()).default({}),
  /** Run from here: only this component and what follows it, fed by what reached it in the last run */
  fromNodeId: z.string().min(1).optional(),
  /** its name as the editor shows it, for the record and the first log line (display only) */
  fromLabel: z.string().trim().min(1).max(200).optional(),
});

/**
 * The user's latest full test run of the flow (not a Run from here): Run from here takes from it what reached the
 * component (never from the client). Null while there is none, or while it still runs.
 */
async function lastFullTestRun(db: Database, orgId: string, flowId: string, userId: string): Promise<RunRecord | null> {
  const [test] = await db.query<{ record: RunRecord }>(
    `SELECT record FROM test_runs
     WHERE org_id = $1 AND flow_id = $2 AND user_id = $3 AND run_from IS NULL AND record IS NOT NULL AND status NOT IN ('queued', 'running')`,
    [orgId, flowId, userId],
  );
  return test?.record ?? null;
}

/**
 * Queues a run of an active flow's saved draft (the editor's Run and Run for real) and wakes the supervisors; answers
 * the run's id right away. The run carries the draft as it is now: editing the flow afterwards changes nothing in it.
 * GET /runs/:id (or its events) follows it. Run for real goes to runs, kept with the history. A test run (validation)
 * goes to test_runs: per flow and user, the latest full test run and the latest Run from here. A full one replaces
 * both (a Run from here's base changed); a Run from here replaces only the previous Run from here (a replaced run that
 * still runs is stopped). Run from here (fromNodeId) runs that component and what follows it, with what reached it in
 * the full test run (refused without one).
 */
export class StartRunHandler implements UseCaseHandler<{ id: string }> {
  async handle(input: unknown, ctx: UseCaseContext): Promise<UseCaseResult<{ id: string }>> {
    const parsed = validate(StartRunCommand, input);
    if (!parsed.ok) {
      return parsed;
    }

    const { id: flowId, mode, parameters, fromNodeId, fromLabel } = parsed.value;
    const row = await new FlowRepository(ctx.db, ctx.orgId).findById(flowId);
    const tree = row ? await loadTree(ctx.db, ctx.orgId, row.projectId) : null;
    if (!row || !tree || !isFolderVisible(tree.folders, row.folderId)) {
      return fail('not-found', 'Flow not found.');
    }

    const { flow: file } = readDraft(row);
    const checked = validateFlowFile(file);
    if (!checked.ok) {
      return fail('validation', `The flow cannot run: ${checked.errors.join(' ')}`);
    }

    let runFrom: RunFromPlan | null = null;
    if (fromNodeId) {
      const last = await lastFullTestRun(ctx.db, ctx.orgId, flowId, ctx.userId);
      if (!last) {
        return fail('validation', 'Run the flow first: Run from here starts from what reached the component in the last test run.');
      }

      const planned = planRunFrom(toExecutableFlow(checked.value, ''), fromNodeId, last.components);
      if (!planned.ok) {
        return fail('validation', planned.error);
      }

      runFrom = { ...planned.plan, label: fromLabel ?? planned.plan.label };
    }

    // the scripts its TypeScript components import (and those import), by the hash of their code as it is now
    const users = checked.value.nodes
      .filter(n => n.type === 'typescript')
      .map(n => ({ label: n.label || 'TypeScript', code: typeof n.config.code === 'string' ? n.config.code : '' }));
    const imported = await scriptsForRun(ctx.db, ctx.orgId, row.projectId, users);
    if (imported.error) {
      return fail('validation', `The flow cannot run: ${imported.error}`);
    }

    const id = crypto.randomUUID();
    const draftHash = new Bun.CryptoHasher('sha256').update(JSON.stringify(checked.value)).digest('hex');
    const values = {
      id,
      orgId: ctx.orgId,
      flowId,
      mode,
      draftHash,
      projectId: row.projectId,
      status: 'queued' as const,
      trigger: 'manual' as const,
      parameters,
      definition: checked.value,
      runFrom,
      scripts: imported.scripts,
    };
    if (mode === 'execution') {
      await ctx.db.orm.insert(runs).values(values);
    } else {
      const replaced = await ctx.db.transaction(async tx => {
        // one at a time per flow and user (two clicks at once)
        await tx.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`test-run:${ctx.orgId}:${flowId}:${ctx.userId}`]);
        // a full run replaces both; a Run from here only the previous Run from here
        const old = await tx.query<{ id: string; status: string }>(
          `DELETE FROM test_runs WHERE org_id = $1 AND flow_id = $2 AND user_id = $3 ${runFrom ? 'AND run_from IS NOT NULL' : ''} RETURNING id, status`,
          [ctx.orgId, flowId, ctx.userId],
        );
        await tx.orm.insert(testRuns).values({ ...values, userId: ctx.userId });
        return old;
      });
      for (const old of replaced) {
        // still running: its supervisor stops it (its end is not stored: the row is gone); its followers are told
        if (old.status === 'running') {
          await ctx.db.notify(CHANNELS.cancel, old.id);
        }

        await notifyRunEvent(ctx.db, { id: old.id, type: 'done' });
      }
    }

    await ctx.db.notify(CHANNELS.queued, 'default');
    return success({ id });
  }
}
