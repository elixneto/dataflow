import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { isFolderVisible, siblingNames, subtreeIds, validateName } from '@dataflow/core';
import type { UseCaseContext } from '#shared/use-cases/use-case-context';
import type { UseCaseHandler } from '#shared/use-cases/use-case-handler';
import { fail, success, type UseCaseResult } from '#shared/use-cases/use-case-result';
import { validate } from '#shared/use-cases/validate';
import { folders } from '../folder';
import { FlowRepository, FolderRepository, loadTree, nameTaken, toFolderView, type FolderView } from '../project-tree';

export const RestoreFolderCommand = z.object({ id: z.uuid('Invalid') });

/**
 * Brings an archived folder back with what was archived with it (same time); items archived on their own before stay
 * archived. When the folder it was in is archived or gone, it comes back at the project's root.
 */
export class RestoreFolderHandler implements UseCaseHandler<FolderView> {
  async handle(input: unknown, ctx: UseCaseContext): Promise<UseCaseResult<FolderView>> {
    const parsed = validate(RestoreFolderCommand, input);
    if (!parsed.ok) {
      return parsed;
    }

    const { id } = parsed.value;
    const [folder] = await new FolderRepository(ctx.db, ctx.orgId).findAll(eq(folders.id, id));
    if (!folder?.deletedAt) {
      return fail('not-found', 'Archived folder not found.');
    }

    const tree = await loadTree(ctx.db, ctx.orgId, folder.projectId);
    const parentId = isFolderVisible(tree.folders, folder.parentId) ? folder.parentId : null;
    if (validateName(folder.name, siblingNames(tree, 'folder', parentId, id)).error === 'Already in use') {
      return nameTaken('folder', folder.name);
    }

    const archivedAt = folder.deletedAt.getTime();
    const together = (item: { deletedAt: Date | null }) => item.deletedAt?.getTime() === archivedAt;
    const subtree = subtreeIds(tree.folders, id);
    await ctx.db.transaction(async tx => {
      const folderRepository = new FolderRepository(tx, ctx.orgId);
      const flowRepository = new FlowRepository(tx, ctx.orgId);
      for (const item of tree.folders.filter(f => subtree.has(f.id) && f.id !== id && together(f))) {
        await folderRepository.restore(item.id);
      }

      for (const item of tree.flows.filter(f => f.folderId !== null && subtree.has(f.folderId) && together(f))) {
        await flowRepository.restore(item.id);
      }

      await folderRepository.restore(id);
      if (parentId !== folder.parentId) {
        await folderRepository.update(id, { parentId });
      }
    });

    const restored = await new FolderRepository(ctx.db, ctx.orgId).findById(id);
    return success(toFolderView(restored!));
  }
}
