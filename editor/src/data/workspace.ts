import {request} from '#data/api';
import {LEGACY_PROJECTS_KEY, setProjects, type Project} from '#data/projects';
import {LEGACY_FLOWS_KEY, setFlows, type FlowDefinition} from '#data/flows';

/*
 * Loads projects and flows from the runner when the editor opens (main.tsx waits for it). The first time, whatever was
 * in this browser's localStorage, from before the database, goes to the runner; what the database already has wins.
 * The old keys stay in the browser as a backup.
 */

const IMPORTED_KEY = 'dataflow-imported-to-database';

function readLegacy<T>(key: string): T[] {
  try {
    const stored = localStorage.getItem(key);
    return stored ? JSON.parse(stored) as T[] : [];
  } catch {
    return [];
  }
}

async function importLegacy() {
  try {
    if (localStorage.getItem(IMPORTED_KEY)) return;
  } catch {
    return; // no storage: nothing to import
  }
  const projects = readLegacy<Project>(LEGACY_PROJECTS_KEY);
  const flows = readLegacy<FlowDefinition>(LEGACY_FLOWS_KEY);
  if (projects.length || flows.length) {
    const imported = await request<{projects: number; flows: number}>('/import', {
      method: 'POST', body: JSON.stringify({projects, flows}), headers: {'content-type': 'application/json'},
    });
    console.info(`Imported from this browser into the database: ${imported.projects} project(s) and ${imported.flows} flow(s).`);
  }
  localStorage.setItem(IMPORTED_KEY, new Date().toISOString());
}

export async function loadWorkspace() {
  await importLegacy();
  const [projects, flows] = await Promise.all([request<Project[]>('/projects'), request<FlowDefinition[]>('/flows')]);
  setProjects(projects);
  setFlows(flows);
}
