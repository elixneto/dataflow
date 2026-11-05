/** The app's URLs, in one place: every link and the router use these. */

export const PROJECTS_PATH = '/projects';

/** the organization's run history; a link to a run is ?q=<its id> (its tree only, that run chosen) */
export const RUNS_PATH = '/runs';

/** a run's own page: its errors, logs, metrics and data (the tab in ?tab=) */
export const runPath = (runId: string, tab?: string) => `/runs/${runId}${tab ? `?tab=${tab}` : ''}`;

/** the Runs page on a run: only its tree, it chosen */
export const runInHistoryPath = (runId: string) => `/runs?q=${runId}`;

/** the tabs of a project */
export type ProjectTab = 'flows' | 'scripts' | 'connections' | 'secrets' | 'files';

/** a project's tab (flows by default) */
export const projectTabPath = (projectId: string, tab: ProjectTab = 'flows') => `/projects/${projectId}/${tab}`;

/** a project's folders and flows; `folderId` opens that folder (Cards view) */
export const projectPath = (projectId: string, folderId?: string) =>
  `${projectTabPath(projectId, 'flows')}${folderId ? `?folder=${folderId}` : ''}`;

/** a flow in the editor */
export const flowPath = (projectId: string, flowId: string) => `/projects/${projectId}/flows/${flowId}`;

/** a project's script in the Scripts tab */
export const scriptPath = (projectId: string, path: string) => `${projectTabPath(projectId, 'scripts')}?script=${encodeURIComponent(path)}`;
