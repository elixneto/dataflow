import { z } from 'zod';
import { isFolderVisible, siblingNames, validateName } from '@dataflow/core';
import { FlowRepository, invalidName, loadTree, nameTaken, toFlowView, type FlowView } from '#features/folders/project-tree';
import type { UseCaseContext } from '#shared/use-cases/use-case-context';
import type { UseCaseHandler } from '#shared/use-cases/use-case-handler';
import { fail, success, type UseCaseResult } from '#shared/use-cases/use-case-result';
import { validate } from '#shared/use-cases/validate';

export const RenameFlowCommand = z.object({ id: z.uuid('Invalid'), name: z.string() });

/**
 * Renames an active flow; the name stays unique in its folder. Only the flows row changes: same id, no new version,
 * no deploy (the name is not part of what runs).
 */
export class RenameFlowHandler implements UseCaseHandler<FlowView> {
  async handle(input: unknown, ctx: UseCaseContext): Promise<UseCaseResult<FlowView>> {
    const parsed = validate(RenameFlowCommand, input);
    if (!parsed.ok) {
      return parsed;
    }

    const repository = new FlowRepository(ctx.db, ctx.orgId);
    const flow = await repository.findById(parsed.value.id);
    const tree = flow ? await loadTree(ctx.db, ctx.orgId, flow.projectId) : null;
    if (!flow || !tree || !isFolderVisible(tree.folders, flow.folderId)) {
      return fail('not-found', 'Flow not found.');
    }

    const { value: name, error } = validateName(parsed.value.name, siblingNames(tree, 'flow', flow.folderId, flow.id));
    if (error) {
      return error === 'Already in use' ? nameTaken('flow', name) : invalidName(error);
    }

    const renamed = await repository.update(flow.id, { name, updatedAt: new Date(), updatedBy: ctx.userId });
    return renamed ? success(toFlowView(renamed)) : fail('not-found', 'Flow not found.');
  }
}
