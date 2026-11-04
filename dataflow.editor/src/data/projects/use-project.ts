import { useEffect, useState } from 'react';
import type { ApiError } from '@/lib/api';
import type { Project } from './project';
import { getProject } from './projects-api';

export type ProjectState = { status: 'loading' } | { status: 'error'; error: ApiError } | { status: 'ready'; project: Project };

/** One project from the server (for a page's header), reloaded when the id changes. */
export function useProject(id: string): ProjectState {
  const [loaded, setLoaded] = useState<{ for: string; state: ProjectState } | null>(null);

  useEffect(() => {
    let current = true;
    void getProject(id).then(result => {
      if (current) {
        setLoaded({ for: id, state: result.ok ? { status: 'ready', project: result.value } : { status: 'error', error: result.error } });
      }
    });

    return () => {
      current = false;
    };
  }, [id]);

  return loaded?.for === id ? loaded.state : { status: 'loading' };
}

/** a project's tabs are read-only while it is archived */
export const isReadOnly = (project: ProjectState) => project.status === 'ready' && project.project.archivedAt !== null;
