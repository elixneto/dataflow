/** The app's URLs, in one place: every link and the router use these. */

export const PROJECTS_PATH = '/projects';

/** the tabs of a project */
export type ProjectTab = 'flows' | 'connections' | 'secrets' | 'files';

/** a project's tab (flows by default) */
export const projectTabPath = (projectId: string, tab: ProjectTab = 'flows') => `/projects/${projectId}/${tab}`;

/** a project's folders and flows; `folderId` opens that folder (Cards view) */
export const projectPath = (projectId: string, folderId?: string) =>
  `${projectTabPath(projectId, 'flows')}${folderId ? `?folder=${folderId}` : ''}`;

/** a flow in the editor */
export const flowPath = (projectId: string, flowId: string) => `/projects/${projectId}/flows/${flowId}`;
