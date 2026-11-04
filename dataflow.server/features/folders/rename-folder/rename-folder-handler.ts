import { z } from 'zod';
import { isFolderVisible, siblingNames, validateName } from '@dataflow/core';
import type { UseCaseContext } from '#shared/use-cases/use-case-context';
import type { UseCaseHandler } from '#shared/use-cases/use-case-handler';
import { fail, success, type UseCaseResult } from '#shared/use-cases/use-case-result';
import { validate } from '#shared/use-cases/validate';
import { FolderRepository, invalidName, loadTree, nameTaken, toFolderView, type FolderView } from '../project-tree';

export const RenameFolderCommand = z.object({ id: z.uuid('Invalid'), name: z.string() });

/** Renames an active folder; the name stays unique among its siblings. */
export class RenameFolderHandler implements UseCaseHandler<FolderView> {
  async handle(input: unknown, ctx: UseCaseContext): Promise<UseCaseResult<FolderView>> {
    const parsed = validate(RenameFolderCommand, input);
    if (!parsed.ok) {
      return parsed;
    }

    const repository = new FolderRepository(ctx.db, ctx.orgId);
    const folder = await repository.findById(parsed.value.id);
    const tree = folder ? await loadTree(ctx.db, ctx.orgId, folder.projectId) : null;
    if (!folder || !tree || !isFolderVisible(tree.folders, folder.id)) {
      return fail('not-found', 'Folder not found.');
    }

    const { value: name, error } = validateName(parsed.value.name, siblingNames(tree, 'folder', folder.parentId, folder.id));
    if (error) {
      return error === 'Already in use' ? nameTaken('folder', name) : invalidName(error);
    }

    const renamed = await repository.update(folder.id, { name });
    return renamed ? success(toFolderView(renamed)) : fail('not-found', 'Folder not found.');
  }
}
