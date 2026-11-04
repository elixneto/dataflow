import { useSyncExternalStore } from 'react';
import { insideScriptFolder, movedScriptPath, normalizeScriptPath, scriptPathIssue } from '@dataflow/core';

/*
 * MOCK: a project's scripts, in this browser tab's memory (lost on reload), until the server keeps them. Everything the
 * pages use goes through these functions, so the API takes their place later. Rules (paths) come from the core.
 */

/** a script: its path (folders and name, no .ts) and its code */
export type Script = { path: string; code: string };

/** a project's scripts and the folders that have no script yet */
type ProjectScripts = { scripts: Script[]; folders: string[] };

const SEED: Script[] = [
  {
    path: 'upload/types',
    code: `/** What the storage answers when an upload starts */
export interface IUploadInitResponse {
  file: {
    uploadId: string;
    targetId: string;
  };
  fileName: string;
  targetKey: string;
  params: Record<string, string>;
}

export function uploadIdOf(response: IUploadInitResponse): string {
  return response.file.uploadId;
}
`,
  },
  {
    path: 'upload/headers',
    code: `import type { IUploadInitResponse } from '@myproject/scripts/upload/types';

/** The form fields an upload sends, from what its start answered */
export function uploadFields(response: IUploadInitResponse): Record<string, string> {
  return { key: response.targetKey, ...response.params };
}
`,
  },
];

const store = new Map<string, ProjectScripts>();
const listeners = new Set<() => void>();
const changed = () => listeners.forEach(listener => listener());

const projectOf = (projectId: string): ProjectScripts => {
  let project = store.get(projectId);
  if (!project) {
    project = { scripts: SEED.map(s => ({ ...s })).sort((a, b) => a.path.localeCompare(b.path)), folders: [] };
    store.set(projectId, project);
  }

  return project;
};

const update = (projectId: string, next: ProjectScripts) => {
  store.set(projectId, { scripts: [...next.scripts].sort((a, b) => a.path.localeCompare(b.path)), folders: [...new Set(next.folders)].sort() });
  changed();
};

/** the project's scripts and empty folders, as they are now */
export const projectScripts = (projectId: string): ProjectScripts => projectOf(projectId);

/** the project's scripts and empty folders, kept up to date */
export function useProjectScripts(projectId: string): ProjectScripts {
  return useSyncExternalStore(
    listener => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => projectOf(projectId),
  );
}

/** every folder of the project: the ones with scripts (and their parents) and the empty ones */
export function scriptFolders(project: ProjectScripts): string[] {
  const all = new Set(project.folders);
  // the folders above a script, and above an empty folder
  for (const path of [...project.scripts.map(s => s.path), ...project.folders]) {
    const parts = path.split('/');
    for (let i = 1; i < parts.length; i++) {
      all.add(parts.slice(0, i).join('/'));
    }
  }

  return [...all].sort();
}

/** what makes a new path impossible: invalid, or a script or a folder already there */
export function newPathIssue(projectId: string, text: string): string | null {
  const path = normalizeScriptPath(text);
  const issue = scriptPathIssue(path);
  if (issue) {
    return issue;
  }

  const project = projectOf(projectId);
  if (project.scripts.some(s => s.path === path)) {
    return 'A script with this path already exists.';
  }

  if (scriptFolders(project).includes(path)) {
    return 'A folder with this path already exists.';
  }

  return project.scripts.some(s => path.startsWith(`${s.path}/`)) ? 'A script cannot hold other scripts: pick another folder.' : null;
}

export function createScript(projectId: string, text: string): string {
  const path = normalizeScriptPath(text);
  const project = projectOf(projectId);
  update(projectId, { ...project, scripts: [...project.scripts, { path, code: `export function example(): string {\n  return 'hello';\n}\n` }] });
  return path;
}

export function createFolder(projectId: string, text: string): string {
  const path = normalizeScriptPath(text);
  const project = projectOf(projectId);
  update(projectId, { ...project, folders: [...project.folders, path] });
  return path;
}

export function saveScript(projectId: string, path: string, code: string) {
  const project = projectOf(projectId);
  update(projectId, { ...project, scripts: project.scripts.map(s => (s.path === path ? { ...s, code } : s)) });
}

/** renames (or moves) a script or a folder with everything in it */
export function renameScriptPath(projectId: string, from: string, text: string): string {
  const to = normalizeScriptPath(text);
  const project = projectOf(projectId);
  update(projectId, {
    scripts: project.scripts.map(s => ({ ...s, path: movedScriptPath(s.path, from, to) })),
    folders: project.folders.map(f => movedScriptPath(f, from, to)),
  });
  return to;
}

/** deletes a script, or a folder with everything in it */
export function deleteScriptPath(projectId: string, path: string) {
  const project = projectOf(projectId);
  update(projectId, {
    scripts: project.scripts.filter(s => !insideScriptFolder(s.path, path)),
    folders: project.folders.filter(f => !insideScriptFolder(f, path)),
  });
}
