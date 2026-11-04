import { isFolderVisible } from '@dataflow/core';
import type { Flow, Folder, ProjectContents } from './flow';

/*
 * The rules of a project's folders and flows come from @dataflow/core (folder-tree), the same the server enforces, so
 * the screens show an error as you type and the server answers the same. Here only what the screens add.
 */

export {
  byName,
  canMoveFolder,
  childrenOf,
  folderPath,
  isFolderVisible,
  itemCount,
  siblingNames,
  subtreeIds,
} from '@dataflow/core';

/**
 * The Archived list: what was archived on its own or at the top of an archived folder, last archived first. What went
 * with a folder (archived at the same moment, inside it) is not listed apart: restoring the folder brings it back.
 */
export function archivedItems(contents: ProjectContents): ({ kind: 'folder'; item: Folder } | { kind: 'flow'; item: Flow })[] {
  const sameMoment = (a: Date | null, b: Date | null) => a !== null && b !== null && a.getTime() === b.getTime();
  const parentArchivedWith = (parentId: string | null, archivedAt: Date | null) => {
    const parent = contents.folders.find(f => f.id === parentId);
    return parent !== undefined && sameMoment(parent.archivedAt, archivedAt);
  };

  const items = [
    ...contents.folders
      .filter(f => f.archivedAt !== null && !parentArchivedWith(f.parentId, f.archivedAt))
      .map(item => ({ kind: 'folder' as const, item })),
    ...contents.flows
      .filter(f => f.archivedAt !== null && !parentArchivedWith(f.folderId, f.archivedAt))
      .map(item => ({ kind: 'flow' as const, item })),
  ];

  return items.sort((a, b) => b.item.archivedAt!.getTime() - a.item.archivedAt!.getTime());
}

/** a flow is visible when it is active and its folder (and every folder above) is too */
export const isFlowVisible = (folders: Folder[], flow: Flow) => flow.archivedAt === null && isFolderVisible(folders, flow.folderId);
