import { useEffect, useSyncExternalStore } from 'react';
import { normalizeScriptPath, scriptContentIssue, scriptExports, scriptPathIssue, type ScriptExport } from '@dataflow/core';
import { api, type ApiResult } from '@/lib/api';

/*
 * A project's scripts from the server (/projects/:id/scripts), kept for every editor of the page: the Scripts tab, and
 * Monaco (a TypeScript component imports them). The list has no code, only what each script exports (what auto-import
 * offers); a script's code is loaded when it is opened, or when the code open imports it. Typing changes it here at
 * once; it is saved a second after the last key (or at Ctrl+S) with the revision it was read at, as the flow drafts: a
 * save from elsewhere in between is a conflict. Rules (paths, 1 MB) come from the core.
 */

/** a script in the list: its path (folders and name, no .ts) and the names it exports */
export type ScriptEntry = { path: string; exports: ScriptExport[] };

/** a script's code as loaded (and typed since), and the revision it was read at */
export type ScriptContent = { code: string; revision: number };

export type SaveState = 'saved' | 'unsaved' | 'saving' | 'conflict' | 'error';

/** a project's scripts as the page has them */
export type ProjectScripts = {
  status: 'loading' | 'ready' | 'error';
  error?: string;
  scripts: ScriptEntry[];
  folders: string[];
  /** the code of the scripts loaded so far, by path */
  contents: Record<string, ScriptContent>;
  save: SaveState;
  /** why the last save failed (too large...) */
  saveError?: string;
};

const EMPTY: ProjectScripts = { status: 'loading', scripts: [], folders: [], contents: {}, save: 'saved' };
/** a second after the last key */
const SAVE_DELAY_MS = 1000;

const store = new Map<string, ProjectScripts>();
const listeners = new Set<() => void>();
const loading = new Map<string, Promise<void>>();
const contentLoads = new Map<string, Promise<void>>();
/** per project and path: the save waiting for its moment */
const pending = new Map<string, ReturnType<typeof setTimeout>>();
const key = (projectId: string, path: string) => `${projectId}\n${path}`;

const set = (projectId: string, next: Partial<ProjectScripts>) => {
  store.set(projectId, { ...(store.get(projectId) ?? EMPTY), ...next });
  listeners.forEach(listener => listener());
};

/** the project's scripts as they are now */
export const projectScripts = (projectId: string): ProjectScripts => store.get(projectId) ?? EMPTY;

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

/** follows the project's scripts from outside React (Monaco): the listener runs at each change */
export const watchScripts = subscribe;

type ListDto = { scripts: { path: string; exports: ScriptExport[] }[]; folders: string[] };

/** reads the project's list of scripts from the server again (the code loaded stays, unless its script is gone) */
export function reloadScripts(projectId: string): Promise<void> {
  const load = api<ListDto>(`/projects/${projectId}/scripts`).then(result => {
    if (!result.ok) {
      set(projectId, { status: 'error', error: result.error.message });
      return;
    }

    const paths = new Set(result.value.scripts.map(s => s.path));
    const contents = Object.fromEntries(Object.entries(projectScripts(projectId).contents).filter(([path]) => paths.has(path)));
    set(projectId, { status: 'ready', error: undefined, scripts: result.value.scripts.map(s => ({ path: s.path, exports: s.exports })), folders: result.value.folders, contents });
  });
  loading.set(projectId, load);
  return load;
}

/** the project's scripts, kept up to date (loaded when first asked) */
export function useProjectScripts(projectId: string): ProjectScripts {
  useEffect(() => {
    if (projectId && !loading.has(projectId)) {
      void reloadScripts(projectId);
    }
  }, [projectId]);
  // the same on the server (a form rendered to text: tests)
  return useSyncExternalStore(subscribe, () => projectScripts(projectId), () => projectScripts(projectId));
}

/** loads a script's code (once; again with `fresh`) */
export function loadScriptContent(projectId: string, path: string, fresh = false): Promise<void> {
  const k = key(projectId, path);
  if (!fresh && (projectScripts(projectId).contents[path] || contentLoads.has(k))) {
    return contentLoads.get(k) ?? Promise.resolve();
  }

  const load = api<{ content: string; revision: number }>(`/projects/${projectId}/scripts/content?path=${encodeURIComponent(path)}`).then(result => {
    contentLoads.delete(k);
    if (result.ok) {
      set(projectId, { contents: { ...projectScripts(projectId).contents, [path]: { code: result.value.content, revision: result.value.revision } } });
    }
  });
  contentLoads.set(k, load);
  return load;
}

/** a script's code, loaded when first asked (undefined meanwhile) */
export function useScriptContent(projectId: string, path: string | null): ScriptContent | undefined {
  const project = useProjectScripts(projectId);
  useEffect(() => {
    if (path && project.status === 'ready' && project.scripts.some(s => s.path === path)) {
      void loadScriptContent(projectId, path);
    }
  }, [projectId, path, project.status, project.scripts]);
  return path ? project.contents[path] : undefined;
}

/** every folder of the project (the server answers them all: above a script, above an empty folder, the empty ones) */
export const scriptFolders = (project: ProjectScripts): string[] => project.folders;

/** what makes a new path impossible, as far as this page knows (the server checks again) */
export function newPathIssue(projectId: string, text: string): string | null {
  const path = normalizeScriptPath(text);
  const issue = scriptPathIssue(path);
  if (issue) {
    return issue;
  }

  const project = projectScripts(projectId);
  if (project.scripts.some(s => s.path === path)) {
    return 'A script with this path already exists.';
  }

  if (project.folders.includes(path)) {
    return 'A folder with this path already exists.';
  }

  return project.scripts.some(s => path.startsWith(`${s.path}/`)) ? 'A script cannot hold other scripts: pick another folder.' : null;
}

const errorOf = (result: ApiResult<unknown>) => (result.ok ? null : (result.error.fields?.path ?? result.error.fields?.content ?? result.error.message));

/** a new script (an example inside) or folder; null when created, or why not */
export async function createScriptPath(projectId: string, text: string, kind: 'script' | 'folder'): Promise<string | null> {
  const result = await api<{ path: string }>(`/projects/${projectId}/scripts`, { method: 'POST', body: { path: normalizeScriptPath(text), kind } });
  await reloadScripts(projectId);
  return errorOf(result);
}

async function saveNow(projectId: string, path: string) {
  pending.delete(key(projectId, path));
  const content = projectScripts(projectId).contents[path];
  if (!content) {
    return;
  }

  set(projectId, { save: 'saving', saveError: undefined });
  const result = await api<{ revision: number }>(`/projects/${projectId}/scripts/content`, {
    method: 'PUT',
    body: { path, content: content.code, revision: content.revision },
  });
  if (!result.ok) {
    set(projectId, { save: result.error.code === 'conflict' ? 'conflict' : 'error', saveError: errorOf(result) ?? undefined });
    return;
  }

  const now = projectScripts(projectId);
  const latest = now.contents[path];
  // typed again while it saved: that change waits for its own save
  const changedSince = latest && latest.code !== content.code;
  set(projectId, {
    contents: latest ? { ...now.contents, [path]: { ...latest, revision: result.value.revision } } : now.contents,
    // what it exports follows the code saved (auto-import offers it)
    scripts: now.scripts.map(s => (s.path === path ? { ...s, exports: scriptExports(content.code) } : s)),
    save: changedSince || pending.size > 0 ? 'unsaved' : 'saved',
  });
}

/** a script's code as typed: kept here at once, saved a second after the last key (not when larger than 1 MB) */
export function saveScript(projectId: string, path: string, code: string) {
  const project = projectScripts(projectId);
  const content = project.contents[path];
  if (!content || content.code === code) {
    return;
  }

  set(projectId, { contents: { ...project.contents, [path]: { ...content, code } }, save: 'unsaved', saveError: undefined });
  clearTimeout(pending.get(key(projectId, path)));
  const large = scriptContentIssue(code);
  if (large) {
    set(projectId, { save: 'error', saveError: large });
    return;
  }

  pending.set(
    key(projectId, path),
    setTimeout(() => void saveNow(projectId, path), SAVE_DELAY_MS),
  );
}

/** saves what waits now (Ctrl+S, or before a move) */
export async function flushScripts(projectId: string) {
  const waiting = [...pending.keys()].filter(k => k.startsWith(`${projectId}\n`));
  for (const k of waiting) {
    clearTimeout(pending.get(k));
    await saveNow(projectId, k.slice(projectId.length + 1));
  }
}

/** after a conflict: the list and the code loaded, as the server has them now */
export async function reloadAll(projectId: string) {
  await reloadScripts(projectId);
  await Promise.all(Object.keys(projectScripts(projectId).contents).map(path => loadScriptContent(projectId, path, true)));
  set(projectId, { save: 'saved', saveError: undefined });
}

/** renames (moves) a script or a folder with what it holds; null when done, or why not */
export async function renameScriptPath(projectId: string, from: string, text: string): Promise<string | null> {
  await flushScripts(projectId);
  const result = await api<{ path: string }>(`/projects/${projectId}/scripts/move`, { method: 'POST', body: { from, to: normalizeScriptPath(text) } });
  await reloadScripts(projectId);
  return errorOf(result);
}

/** deletes a script, or a folder with everything in it */
export async function deleteScriptPath(projectId: string, path: string): Promise<string | null> {
  for (const k of [...pending.keys()].filter(k => k.startsWith(`${projectId}\n${path}`))) {
    clearTimeout(pending.get(k));
    pending.delete(k);
  }

  const result = await api<{ path: string }>(`/projects/${projectId}/scripts/delete`, { method: 'POST', body: { path } });
  await reloadScripts(projectId);
  return errorOf(result);
}

/** who imports a path (a script, or anything in a folder): what a move or a delete would break */
export async function scriptUsage(projectId: string, path: string): Promise<{ flows: { id: string; name: string }[]; scripts: string[] }> {
  const result = await api<{ flows: { id: string; name: string }[]; scripts: string[] }>(`/projects/${projectId}/scripts/usage?path=${encodeURIComponent(path)}`);
  return result.ok ? result.value : { flows: [], scripts: [] };
}
