import { z } from 'zod';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { isFolderVisible, validateFlowFile } from '@dataflow/core';
import { FlowRepository, loadTree } from '#features/folders/project-tree';
import type { UseCaseContext } from '#shared/use-cases/use-case-context';
import type { UseCaseHandler } from '#shared/use-cases/use-case-handler';
import { fail, success, type UseCaseResult } from '#shared/use-cases/use-case-result';
import { validate } from '#shared/use-cases/validate';
import { flows } from '../flow';
import { revisionOf, type StoredDraft } from '../flow-draft';

export const SaveDraftCommand = z.object({
  id: z.uuid('Invalid'),
  /** the revision the editor started from (what it read or last saved) */
  revision: z.number().int().min(0),
  flow: z.unknown(),
});

/**
 * Saves the editor's draft of an active flow: checked with the core's rules (validateFlowFile: its shape and the
 * connection rules; a component's own settings may be incomplete), stored with the next revision. Refused (conflict)
 * when the draft is no longer at the revision the editor started from: another save came in between. The flow's id
 * and name are the row's (renaming is apart).
 */
export class SaveDraftHandler implements UseCaseHandler<{ revision: number }> {
  async handle(input: unknown, ctx: UseCaseContext): Promise<UseCaseResult<{ revision: number }>> {
    const parsed = validate(SaveDraftCommand, input);
    if (!parsed.ok) {
      return parsed;
    }

    const { id, revision } = parsed.value;
    const row = await new FlowRepository(ctx.db, ctx.orgId).findById(id);
    const tree = row ? await loadTree(ctx.db, ctx.orgId, row.projectId) : null;
    if (!row || !tree || !isFolderVisible(tree.folders, row.folderId)) {
      return fail('not-found', 'Flow not found.');
    }

    const checked = validateFlowFile(parsed.value.flow);
    if (!checked.ok) {
      return fail('validation', `The flow is not valid: ${checked.errors.join(' ')}`);
    }

    if (revisionOf(row) !== revision) {
      return conflict();
    }

    const draft: StoredDraft = { revision: revision + 1, flow: { ...checked.value, id: row.id, name: row.name } };
    // only if nobody saved since it was read (the check above and this write are one step for the database)
    const saved = await ctx.db.orm
      .update(flows)
      .set({ draftDefinition: draft, updatedAt: new Date(), updatedBy: ctx.userId })
      .where(
        and(
          eq(flows.orgId, ctx.orgId),
          eq(flows.id, id),
          isNull(flows.deletedAt),
          sql`coalesce((${flows.draftDefinition}->>'revision')::int, 0) = ${revision}`,
        ),
      )
      .returning({ id: flows.id });
    return saved.length > 0 ? success({ revision: draft.revision }) : conflict();
  }
}

const conflict = () => fail('conflict', 'This flow was changed elsewhere. Reload it to see the latest version.');
