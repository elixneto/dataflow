import { z } from 'zod';
import { isFolderVisible, siblingNames, validateName, type ExecutableWorkflow } from '@dataflow/core';
import { FlowRepository, invalidName, loadTree, location, nameTaken, requireActiveProject } from '#features/folders/project-tree';
import type { UseCaseContext } from '#shared/use-cases/use-case-context';
import type { UseCaseHandler } from '#shared/use-cases/use-case-handler';
import { fail, success, type UseCaseResult } from '#shared/use-cases/use-case-result';
import { validate } from '#shared/use-cases/validate';

export const CreateFlowCommand = z.object({
  projectId: z.uuid('Invalid'),
  folderId: location,
  name: z.string(),
});

/**
 * The draft of a new flow: no parameters, components or connections yet. The editor adds Start and End (with their
 * places on the canvas) the first time it opens it.
 */
export const EMPTY_DRAFT: Pick<ExecutableWorkflow, 'parameters' | 'nodes' | 'edges'> = { parameters: [], nodes: [], edges: [] };

/** Creates an empty flow at the project's root or in an active folder. An archived project takes no new flows. */
export class CreateFlowHandler implements UseCaseHandler<{ id: string }> {
  async handle(input: unknown, ctx: UseCaseContext): Promise<UseCaseResult<{ id: string }>> {
    const parsed = validate(CreateFlowCommand, input);
    if (!parsed.ok) {
      return parsed;
    }

    const { projectId, folderId } = parsed.value;
    const missing = await requireActiveProject(ctx, projectId);
    if (missing) {
      return missing;
    }

    const tree = await loadTree(ctx.db, ctx.orgId, projectId);
    if (!isFolderVisible(tree.folders, folderId)) {
      return fail('not-found', 'Folder not found.');
    }

    const { value: name, error } = validateName(parsed.value.name, siblingNames(tree, 'flow', folderId));
    if (error) {
      return error === 'Already in use' ? nameTaken('flow', name) : invalidName(error);
    }

    const flow = await new FlowRepository(ctx.db, ctx.orgId).insert({
      id: crypto.randomUUID(),
      projectId,
      folderId,
      name,
      draftDefinition: EMPTY_DRAFT,
      updatedBy: ctx.userId,
    });
    return success({ id: flow.id });
  }
}
