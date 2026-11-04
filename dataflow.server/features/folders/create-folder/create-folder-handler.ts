import { z } from 'zod';
import { isFolderVisible, siblingNames, validateName } from '@dataflow/core';
import type { UseCaseContext } from '#shared/use-cases/use-case-context';
import type { UseCaseHandler } from '#shared/use-cases/use-case-handler';
import { fail, success, type UseCaseResult } from '#shared/use-cases/use-case-result';
import { validate } from '#shared/use-cases/validate';
import { FolderRepository, invalidName, loadTree, location, nameTaken, requireActiveProject } from '../project-tree';

export const CreateFolderCommand = z.object({
  projectId: z.uuid('Invalid'),
  parentId: location,
  name: z.string(),
});

/** Creates a folder at the project's root or inside an active folder. An archived project takes no new folders. */
export class CreateFolderHandler implements UseCaseHandler<{ id: string }> {
  async handle(input: unknown, ctx: UseCaseContext): Promise<UseCaseResult<{ id: string }>> {
    const parsed = validate(CreateFolderCommand, input);
    if (!parsed.ok) {
      return parsed;
    }

    const { projectId, parentId } = parsed.value;
    const missing = await requireActiveProject(ctx, projectId);
    if (missing) {
      return missing;
    }

    const tree = await loadTree(ctx.db, ctx.orgId, projectId);
    if (!isFolderVisible(tree.folders, parentId)) {
      return fail('not-found', 'Folder not found.');
    }

    const { value: name, error } = validateName(parsed.value.name, siblingNames(tree, 'folder', parentId));
    if (error) {
      return error === 'Already in use' ? nameTaken('folder', name) : invalidName(error);
    }

    const folder = await new FolderRepository(ctx.db, ctx.orgId).insert({ id: crypto.randomUUID(), projectId, parentId, name });
    return success({ id: folder.id });
  }
}
