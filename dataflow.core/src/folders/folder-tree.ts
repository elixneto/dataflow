/*
 * The rules of a project's folders and flows, shared by the server (which enforces them) and the editor (which shows
 * them as you type). Folders are only a visual organization: a flow keeps its id when it moves or is renamed, and its
 * definition (what runs) does not change, so neither needs a deploy.
 * - names are unique among siblings (same folder), ignoring case, counting only active items;
 * - archiving a folder archives everything under it (same moment); restoring it brings back what went with it;
 * - a folder cannot move into itself or anything under it.
 */

export type TreeFolder = {id: string; parentId: string | null; name: string; archivedAt: unknown};
export type TreeFlow = {id: string; folderId: string | null; name: string; archivedAt: unknown};
export type TreeContents<F extends TreeFolder = TreeFolder, W extends TreeFlow = TreeFlow> = {folders: F[]; flows: W[]};

export const NAME_MAX = 100;

const isActive = (item: {archivedAt: unknown}) => item.archivedAt === null || item.archivedAt === undefined;

export const byName = <T extends {name: string}>(a: T, b: T) => a.name.localeCompare(b.name, 'en', {sensitivity: 'base'});

/** A folder's or flow's name trimmed, and its error if invalid: required, at most 100 characters, unique among `siblings`. */
export function validateName(name: string, siblings: {name: string}[]): {value: string; error?: string} {
  const value = name.trim();
  if (value === '') return {value, error: 'Required'};
  if (value.length > NAME_MAX) return {value, error: `At most ${NAME_MAX} characters`};
  const taken = siblings.some(sibling => sibling.name.toLowerCase() === value.toLowerCase());
  return taken ? {value, error: 'Already in use'} : {value};
}

/** The folder and its parents, from the root down to it ([] for the root). */
export function folderPath<F extends TreeFolder>(folders: F[], folderId: string | null): F[] {
  const path: F[] = [];
  const seen = new Set<string>();
  let current = folders.find(f => f.id === folderId);
  while (current && !seen.has(current.id)) {
    seen.add(current.id);
    path.unshift(current);
    const parentId: string | null = current.parentId;
    current = folders.find(f => f.id === parentId);
  }
  return path;
}

/** A flow's whole path, as a Flow Invoker names it by expression: its folders and its name (`Imports/Bynder/Main`). */
export const flowPath = (folders: TreeFolder[], flow: {folderId: string | null; name: string}) =>
  [...folderPath(folders, flow.folderId).map(f => f.name), flow.name].join('/');

/** a path as written, for comparing: no slashes at the ends nor spaces around them, any case */
export const normalizedFlowPath = (path: string) =>
  path.trim().replace(/\s*\/\s*/g, '/').replace(/^\/+|\/+$/g, '').toLowerCase();

/** The ids of the folder and of every folder under it. */
export function subtreeIds(folders: TreeFolder[], folderId: string): Set<string> {
  const ids = new Set([folderId]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const folder of folders) {
      if (folder.parentId !== null && ids.has(folder.parentId) && !ids.has(folder.id)) {
        ids.add(folder.id);
        grew = true;
      }
    }
  }
  return ids;
}

/** Active, with every folder above it active too (the root always is). */
export function isFolderVisible(folders: TreeFolder[], folderId: string | null): boolean {
  if (folderId === null) return true;
  const path = folderPath(folders, folderId);
  return path.length > 0 && path[path.length - 1]!.id === folderId && path.every(isActive);
}

/** What is active directly inside a folder (or the root), folders and flows each by name. */
export function childrenOf<F extends TreeFolder, W extends TreeFlow>(contents: TreeContents<F, W>, folderId: string | null): {folders: F[]; flows: W[]} {
  return {
    folders: contents.folders.filter(f => f.parentId === folderId && isActive(f)).sort(byName),
    flows: contents.flows.filter(f => f.folderId === folderId && isActive(f)).sort(byName),
  };
}

/** How many active items a folder holds directly. */
export function itemCount(contents: TreeContents, folderId: string): number {
  const {folders, flows} = childrenOf(contents, folderId);
  return folders.length + flows.length;
}

/** The active items next to which a folder or flow would sit in `folderId`, without `exceptId` (the one renamed or moved). */
export function siblingNames(contents: TreeContents, kind: 'folder' | 'flow', folderId: string | null, exceptId?: string): {name: string}[] {
  const {folders, flows} = childrenOf(contents, folderId);
  return (kind === 'folder' ? folders : flows).filter(item => item.id !== exceptId);
}

/** Whether a folder may move into `targetId` (null = root): not into itself or under itself, and only into a visible folder. */
export function canMoveFolder(folders: TreeFolder[], folderId: string, targetId: string | null): boolean {
  if (targetId !== null && subtreeIds(folders, folderId).has(targetId)) return false;
  return isFolderVisible(folders, targetId);
}
