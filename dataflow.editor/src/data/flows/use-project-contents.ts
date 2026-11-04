import { useCallback, useEffect, useState } from 'react';
import type { ApiError, ApiResult } from '@/lib/api';
import type { ProjectContents } from './flow';
import * as flowsApi from './flows-api';

type State = { status: 'loading' } | { status: 'error'; error: ApiError } | { status: 'ready'; contents: ProjectContents };

const toState = (result: ApiResult<ProjectContents>): State =>
  result.ok ? { status: 'ready', contents: result.value } : { status: 'error', error: result.error };

/**
 * A project's folders and flows: loads when the project changes, `reload` after a failure; every change reloads them
 * when it succeeds and returns the answer (field errors for the dialogs).
 */
export function useProjectContents(projectId: string) {
  const [loaded, setLoaded] = useState<{ for: string; state: State } | null>(null);
  const state: State = loaded?.for === projectId ? loaded.state : { status: 'loading' };

  const reload = useCallback(async () => {
    setLoaded({ for: projectId, state: { status: 'loading' } });
    setLoaded({ for: projectId, state: toState(await flowsApi.getProjectContents(projectId)) });
  }, [projectId]);

  useEffect(() => {
    let current = true;
    void flowsApi.getProjectContents(projectId).then(result => {
      if (current) {
        setLoaded({ for: projectId, state: toState(result) });
      }
    });

    return () => {
      current = false;
    };
  }, [projectId]);

  const thenRefresh = useCallback(
    async <T,>(change: Promise<ApiResult<T>>): Promise<ApiResult<T>> => {
      const result = await change;
      if (result.ok) {
        const contents = await flowsApi.getProjectContents(projectId);
        if (contents.ok) {
          setLoaded({ for: projectId, state: toState(contents) });
        }
      }

      return result;
    },
    [projectId],
  );

  return {
    state,
    reload,
    createFolder: (parentId: string | null, name: string) => thenRefresh(flowsApi.createFolder(projectId, parentId, name)),
    renameFolder: (id: string, name: string) => thenRefresh(flowsApi.renameFolder(id, name)),
    moveFolder: (id: string, parentId: string | null) => thenRefresh(flowsApi.moveFolder(id, parentId)),
    archiveFolder: (id: string) => thenRefresh(flowsApi.archiveFolder(id)),
    restoreFolder: (id: string) => thenRefresh(flowsApi.restoreFolder(id)),
    createFlow: (folderId: string | null, name: string) => thenRefresh(flowsApi.createFlow(projectId, { name, folderId })),
    renameFlow: (id: string, name: string) => thenRefresh(flowsApi.renameFlow(id, name)),
    moveFlow: (id: string, folderId: string | null) => thenRefresh(flowsApi.moveFlow(id, folderId)),
    archiveFlow: (id: string) => thenRefresh(flowsApi.archiveFlow(id)),
    restoreFlow: (id: string) => thenRefresh(flowsApi.restoreFlow(id)),
  };
}

export type ProjectContentsActions = ReturnType<typeof useProjectContents>;
