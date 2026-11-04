import { z } from 'zod';
import { isFolderVisible, subtreeIds } from '@dataflow/core';
import type { UseCaseContext } from '#shared/use-cases/use-case-context';
import type { UseCaseHandler } from '#shared/use-cases/use-case-handler';
import { fail, success, type UseCaseResult } from '#shared/use-cases/use-case-result';
import { validate } from '#shared/use-cases/validate';
import { FlowRepository, FolderRepository, loadTree } from '../project-tree';

export const ArchiveFolderCommand = z.object({ id: z.uuid('Invalid') });

/**
 * Archives an active folder and every active folder and flow under it, all with the same time (in one transaction),
 * so restoring the folder knows what went with it. What was archived before stays as it was.
 */
export class ArchiveFolderHandler implements UseCaseHandler<{ id: string }> {
  async handle(input: unknown, ctx: UseCaseContext): Promise<UseCaseResult<{ id: string }>> {
    const parsed = validate(ArchiveFolderCommand, input);
    if (!parsed.ok) {
      return parsed;
    }

    const { id } = parsed.value;
    const folder = await new FolderRepository(ctx.db, ctx.orgId).findById(id);
    const tree = folder ? await loadTree(ctx.db, ctx.orgId, folder.projectId) : null;
    if (!folder || !tree || !isFolderVisible(tree.folders, id)) {
      return fail('not-found', 'Folder not found.');
    }

    const subtree = subtreeIds(tree.folders, id);
    const archive = { deletedAt: new Date(), deletedBy: ctx.userId };
    await ctx.db.transaction(async tx => {
      const folderRepository = new FolderRepository(tx, ctx.orgId);
      const flowRepository = new FlowRepository(tx, ctx.orgId);
      for (const item of tree.folders.filter(f => subtree.has(f.id) && f.archivedAt === null)) {
        await folderRepository.update(item.id, archive);
      }

      for (const item of tree.flows.filter(f => f.folderId !== null && subtree.has(f.folderId) && f.archivedAt === null)) {
        await flowRepository.update(item.id, archive);
      }
    });

    return success({ id });
  }
}
