/*
 * Mock projects, stored in the browser's localStorage (like the flows). Each project has flows, runs,
 * secrets and files; the last three already come from the runner. Becomes an API call when the backend exists.
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

const KEY = 'dataflow-projects-v1';

const DEFAULT = (): Project[] => [
  {id: EXAMPLES_PROJECT, name: 'Examples', description: 'An example flow for each component.', updatedAt: new Date().toISOString()},
];

/** Starts with the default ones; after the first save, what is stored applies. */
export function listProjects(): Project[] {
  try {
    const stored = localStorage.getItem(KEY);
    if (stored) return JSON.parse(stored) as Project[];
  } catch {
    // storage unavailable or corrupted: the default ones
  }
  return DEFAULT();
}

function store(projects: Project[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify(projects));
  } catch {
    // no storage: the mock only lasts until reload
  }
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
  store([...projects, project]);
  return project;
}

export function saveProject(project: Project) {
  store(listProjects().map(p => (p.id === project.id ? {...project, updatedAt: new Date().toISOString()} : p)));
}

export function deleteProject(id: string) {
  store(listProjects().filter(p => p.id !== id));
}

/** Stores an empty folder in the project (a folder that already holds a flow does not need it). */
export function createFolder(projectId: string, path: string) {
  store(listProjects().map(p => (p.id === projectId ? {...p, folders: [...new Set([...(p.folders ?? []), path])]} : p)));
}

/** Replaces the path of the stored folders (rename); an empty `to` deletes the folder and the ones inside it. */
export function replaceFolders(projectId: string, from: string, to: string) {
  const inside = (c: string) => c === from || c.startsWith(from + '/');
  store(listProjects().map(p => (p.id !== projectId ? p : {
    ...p,
    folders: (p.folders ?? []).flatMap(c => (!inside(c) ? [c] : to ? [to + c.slice(from.length)] : [])),
  })));
}
