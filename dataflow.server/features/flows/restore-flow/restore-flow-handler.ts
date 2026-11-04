import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { isFolderVisible, siblingNames, validateName } from '@dataflow/core';
import { FlowRepository, loadTree, nameTaken, toFlowView, type FlowView } from '#features/folders/project-tree';
import type { UseCaseContext } from '#shared/use-cases/use-case-context';
import type { UseCaseHandler } from '#shared/use-cases/use-case-handler';
import { fail, success, type UseCaseResult } from '#shared/use-cases/use-case-result';
import { validate } from '#shared/use-cases/validate';
import { flows } from '../flow';

export const RestoreFlowCommand = z.object({ id: z.uuid('Invalid') });

/** Brings an archived flow back into its folder; to the project's root when that folder is archived or gone. */
export class RestoreFlowHandler implements UseCaseHandler<FlowView> {
  async handle(input: unknown, ctx: UseCaseContext): Promise<UseCaseResult<FlowView>> {
    const parsed = validate(RestoreFlowCommand, input);
    if (!parsed.ok) {
      return parsed;
    }

    const { id } = parsed.value;
    const repository = new FlowRepository(ctx.db, ctx.orgId);
    const [flow] = await repository.findDeleted(eq(flows.id, id));
    if (!flow) {
      return fail('not-found', 'Archived flow not found.');
    }

    const tree = await loadTree(ctx.db, ctx.orgId, flow.projectId);
    const folderId = isFolderVisible(tree.folders, flow.folderId) ? flow.folderId : null;
    if (validateName(flow.name, siblingNames(tree, 'flow', folderId, id)).error === 'Already in use') {
      return nameTaken('flow', flow.name);
    }

    const restored = await ctx.db.transaction(async tx => {
      const inTx = new FlowRepository(tx, ctx.orgId);
      await inTx.restore(id);
      return folderId === flow.folderId ? inTx.findById(id) : inTx.update(id, { folderId });
    });

    return restored ? success(toFlowView(restored)) : fail('not-found', 'Archived flow not found.');
  }
}
