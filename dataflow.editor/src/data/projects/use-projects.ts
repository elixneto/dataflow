import { useCallback, useEffect, useState } from 'react';
import type { ApiError, ApiResult } from '@/lib/api';
import {
  archiveProject,
  createProject,
  listProjects,
  restoreProject,
  updateProject,
  type ProjectStatus,
} from './projects-api';
import type { NewProject, Project } from './project';

type State = { status: 'loading' } | { status: 'error'; error: ApiError } | { status: 'ready'; projects: Project[] };

const toState = (result: ApiResult<Project[]>): State =>
  result.ok ? { status: 'ready', projects: result.value } : { status: 'error', error: result.error };

/**
 * The organization's active or archived projects from the server: loads when `status` changes, `reload` after a
 * failure; create, update, archive and restore reload the list when they succeed and return the server's answer.
 */
export function useProjects(status: ProjectStatus) {
  // what was loaded, and for which status: switching Active/Archived shows "loading" until that list arrives
  const [loaded, setLoaded] = useState<{ for: ProjectStatus; state: State } | null>(null);
  const state: State = loaded?.for === status ? loaded.state : { status: 'loading' };

  const reload = useCallback(async () => {
    setLoaded({ for: status, state: { status: 'loading' } });
    setLoaded({ for: status, state: toState(await listProjects(status)) });
  }, [status]);

  useEffect(() => {
    let current = true;
    void listProjects(status).then(result => {
      if (current) {
        setLoaded({ for: status, state: toState(result) });
      }
    });

    return () => {
      current = false;
    };
  }, [status]);

  /** runs a change and, when it worked, shows the list as the server has it now */
  const thenRefresh = useCallback(
    async <T,>(change: Promise<ApiResult<T>>): Promise<ApiResult<T>> => {
      const result = await change;
      if (result.ok) {
        const list = await listProjects(status);
        if (list.ok) {
          setLoaded({ for: status, state: toState(list) });
        }
      }

      return result;
    },
    [status],
  );

  return {
    state,
    reload,
    create: (project: NewProject) => thenRefresh(createProject(project)),
    update: (id: string, changes: Partial<NewProject>) => thenRefresh(updateProject(id, changes)),
    archive: (id: string) => thenRefresh(archiveProject(id)),
    restore: (id: string) => thenRefresh(restoreProject(id)),
  };
}
