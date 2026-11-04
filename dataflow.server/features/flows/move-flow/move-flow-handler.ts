import { z } from 'zod';
import { isFolderVisible, siblingNames, validateName } from '@dataflow/core';
import { FlowRepository, loadTree, location, nameTaken, toFlowView, type FlowView } from '#features/folders/project-tree';
import type { UseCaseContext } from '#shared/use-cases/use-case-context';
import type { UseCaseHandler } from '#shared/use-cases/use-case-handler';
import { fail, success, type UseCaseResult } from '#shared/use-cases/use-case-result';
import { validate } from '#shared/use-cases/validate';

export const MoveFlowCommand = z.object({ id: z.uuid('Invalid'), folderId: location });

/**
 * Moves an active flow into another active folder of its project, or to the root. Folders are only organization: the
 * flow keeps its id, versions and deployment, so nothing is redeployed.
 */
export class MoveFlowHandler implements UseCaseHandler<FlowView> {
  async handle(input: unknown, ctx: UseCaseContext): Promise<UseCaseResult<FlowView>> {
    const parsed = validate(MoveFlowCommand, input);
    if (!parsed.ok) {
      return parsed;
    }

    const { id, folderId } = parsed.value;
    const repository = new FlowRepository(ctx.db, ctx.orgId);
    const flow = await repository.findById(id);
    const tree = flow ? await loadTree(ctx.db, ctx.orgId, flow.projectId) : null;
    if (!flow || !tree || !isFolderVisible(tree.folders, flow.folderId)) {
      return fail('not-found', 'Flow not found.');
    }

    // the folders of this project only: an id from another project is "not found"
    if (!isFolderVisible(tree.folders, folderId)) {
      return fail('not-found', 'Destination folder not found.');
    }

    if (validateName(flow.name, siblingNames(tree, 'flow', folderId, id)).error === 'Already in use') {
      return nameTaken('flow', flow.name);
    }

    const moved = await repository.update(id, { folderId, updatedAt: new Date(), updatedBy: ctx.userId });
    return moved ? success(toFlowView(moved)) : fail('not-found', 'Flow not found.');
  }
}
