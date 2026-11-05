/*
 * How the user likes the screens, remembered in this browser (the last choice is the one that shows next time):
 * Tree, Cards or Graph for a project's contents, whether the Graph shows the scripts, and whether the flow editor's
 * components panel is open. Storage can be
 * blocked (private mode): then the default, and the choice lasts until the page closes.
 */

export type ProjectView = 'tree' | 'cards' | 'graph';

export const VIEW_KEY = 'dataflow.projectView';
export const PALETTE_KEY = 'dataflow.paletteOpen';
export const GRAPH_SCRIPTS_KEY = 'dataflow.graphScripts';

type Storage = Pick<globalThis.Storage, 'getItem' | 'setItem'>;

const browserStorage = (): Storage | undefined => (typeof localStorage === 'undefined' ? undefined : localStorage);

function read<T extends string>(key: string, allowed: readonly T[], fallback: T, storage: Storage | undefined): T {
  try {
    const stored = storage?.getItem(key);
    return allowed.includes(stored as T) ? (stored as T) : fallback;
  } catch {
    return fallback;
  }
}

function save(key: string, value: string, storage: Storage | undefined): void {
  try {
    storage?.setItem(key, value);
  } catch {
    // storage blocked: the choice lasts until the page closes
  }
}

export const readProjectView = (storage: Storage | undefined = browserStorage()): ProjectView =>
  read(VIEW_KEY, ['tree', 'cards', 'graph'] as const, 'cards', storage);

export const saveProjectView = (view: ProjectView, storage: Storage | undefined = browserStorage()) => save(VIEW_KEY, view, storage);

/** the components panel starts open */
export const readPaletteOpen = (storage: Storage | undefined = browserStorage()): boolean =>
  read(PALETTE_KEY, ['open', 'closed'] as const, 'open', storage) === 'open';

export const savePaletteOpen = (open: boolean, storage: Storage | undefined = browserStorage()) =>
  save(PALETTE_KEY, open ? 'open' : 'closed', storage);

/** the project's Graph shows the scripts at first */
export const readGraphScripts = (storage: Storage | undefined = browserStorage()): boolean =>
  read(GRAPH_SCRIPTS_KEY, ['shown', 'hidden'] as const, 'shown', storage) === 'shown';

export const saveGraphScripts = (shown: boolean, storage: Storage | undefined = browserStorage()) =>
  save(GRAPH_SCRIPTS_KEY, shown ? 'shown' : 'hidden', storage);
