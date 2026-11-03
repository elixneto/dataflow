import {persist} from '#data/api';

/*
 * Projects, stored in the runner's database (like the flows). Each project has flows, runs, secrets and files.
 * Read from the copy loaded when the editor opens (data/workspace.ts); each change is saved in the background.
 */

export type Project = {
  id: string;
  name: string;
  description: string;
  updatedAt: string;
  /** folders created by hand (those holding a flow show up on their own), as a path: "Sales/Invoices" */
  folders?: string[];
};

export const EXAMPLES_PROJECT = 'examples';

/** where the projects lived before the database (data/workspace.ts imports them once) */
export const LEGACY_PROJECTS_KEY = 'dataflow-projects-v1';

let loaded: Project[] = [];

/** the projects that came from the runner (data/workspace.ts) */
export function setProjects(projects: Project[]) {
  loaded = projects;
}

export function listProjects(): Project[] {
  return loaded;
}

/** replaces the project in the copy and saves it */
function put(project: Project) {
  loaded = loaded.some(p => p.id === project.id) ? loaded.map(p => (p.id === project.id ? project : p)) : [...loaded, project];
  persist('PUT', `/projects/${encodeURIComponent(project.id)}`, project);
}

export function getProject(id: string): Project | undefined {
  return listProjects().find(p => p.id === id);
}

/** readable id from the name (becomes the files folder and the secrets key in the runner) */
function idFromName(name: string, existing: string[]) {
  const base = name.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'project';
  let id = base;
  for (let n = 2; existing.includes(id); n++) id = `${base}-${n}`;
  return id;
}

export function createProject(name: string, description: string): Project {
  const projects = listProjects();
  const project: Project = {id: idFromName(name, projects.map(p => p.id)), name, description, updatedAt: new Date().toISOString()};
  put(project);
  return project;
}

export function saveProject(project: Project) {
  put({...project, updatedAt: new Date().toISOString()});
}

/** Deletes the project (the screen only allows it once the project has no flows). */
export function deleteProject(id: string) {
  loaded = loaded.filter(p => p.id !== id);
  persist('DELETE', `/projects/${encodeURIComponent(id)}`);
}

/** Stores an empty folder in the project (a folder that already holds a flow does not need it). */
export function createFolder(projectId: string, path: string) {
  const project = getProject(projectId);
  if (project) put({...project, folders: [...new Set([...(project.folders ?? []), path])]});
}

/** Replaces the path of the stored folders (rename); an empty `to` deletes the folder and the ones inside it. */
export function replaceFolders(projectId: string, from: string, to: string) {
  const project = getProject(projectId);
  const inside = (c: string) => c === from || c.startsWith(from + '/');
  if (project) put({...project, folders: (project.folders ?? []).flatMap(c => (!inside(c) ? [c] : to ? [to + c.slice(from.length)] : []))});
}
