import { z } from 'zod';
import { isFolderVisible, newFlowFile, siblingNames, validateName } from '@dataflow/core';
import { FlowRepository, invalidName, loadTree, location, nameTaken, requireActiveProject } from '#features/folders/project-tree';
import type { UseCaseContext } from '#shared/use-cases/use-case-context';
import type { UseCaseHandler } from '#shared/use-cases/use-case-handler';
import { fail, success, type UseCaseResult } from '#shared/use-cases/use-case-result';
import { validate } from '#shared/use-cases/validate';
import type { StoredDraft } from '../flow-draft';

export const CreateFlowCommand = z.object({
  projectId: z.uuid('Invalid'),
  folderId: location,
  name: z.string(),
});

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

    const id = crypto.randomUUID();
    // the draft of a new flow: its Start and its End (flow-draft.ts)
    const draft: StoredDraft = { revision: 0, flow: newFlowFile(name, id) };
    const flow = await new FlowRepository(ctx.db, ctx.orgId).insert({
      id,
      projectId,
      folderId,
      name,
      draftDefinition: draft,
      updatedBy: ctx.userId,
    });
    return success({ id: flow.id });
  }
}
