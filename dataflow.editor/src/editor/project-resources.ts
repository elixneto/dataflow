import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { SCRIPT_GLOBALS } from '@dataflow/core';
import { listConnections } from '@/data/connections/connections-api';
import { getProjectContents } from '@/data/flows/flows-api';
import { listSecrets } from '@/data/secrets/secrets-api';
import { listVariables } from '@/data/variables/variables-api';

/** what a flow's components may point at: the project's connection profiles, secrets (names only) and flows */
export type ProjectResources = {
  projectId: string;
  connections: { id: string; name: string; type: string }[];
  secrets: string[];
  /** the project's variables ($VARIABLES: plain values) */
  variables: { name: string; value: string }[];
  /** the project's active flows (a Flow Invoker calls one) */
  flows: { id: string; name: string }[];
  /** reads them again (a picker about to be used): at most once every few seconds */
  refresh?: () => void;
};

/** how long a load serves the pickers before one of them asks again */
export const REFRESH_AFTER_MS = 10_000;

export const ProjectResourcesContext = createContext<ProjectResources>({ projectId: '', connections: [], secrets: [], variables: [], flows: [] });

export const useProjectResources = () => useContext(ProjectResourcesContext);

/**
 * what a TypeScript component's code sees in this flow, per component: the core's globals, $PARAMETERS typed from its
 * Start, `Data` typed from what reached the component in the last runs
 */
export const ScriptGlobalsContext = createContext<(nodeId?: string) => string>(() => SCRIPT_GLOBALS);

/** the name of a profile or a flow of the project, for the info panel (undefined when it is not one of them) */
export const nameIn = (resources: ProjectResources) => (id: string) => [...resources.connections, ...resources.flows].find(item => item.id === id)?.name;

/**
 * Loads the project's connections, secrets, variables and flows for the flow editor, once; `refresh` reads them again
 * on demand (a picker the user is about to use: a connection or flow created in another tab shows up in it), at most
 * once every REFRESH_AFTER_MS. Nothing is read in the background.
 */
export function useLoadProjectResources(projectId: string): ProjectResources {
  const [resources, setResources] = useState<ProjectResources>({ projectId, connections: [], secrets: [], variables: [], flows: [] });
  const loaded = useRef<{ projectId: string; at: number; loading: boolean }>({ projectId: '', at: 0, loading: false });
  const load = useCallback(() => {
    const now = Date.now();
    if (loaded.current.projectId === projectId && (loaded.current.loading || now - loaded.current.at < REFRESH_AFTER_MS)) {
      return;
    }

    loaded.current = { projectId, at: now, loading: true };
    void Promise.all([listConnections(projectId), listSecrets(projectId), getProjectContents(projectId), listVariables(projectId)]).then(([connections, secrets, contents, variables]) => {
      if (loaded.current.projectId !== projectId) {
        return;
      }

      loaded.current.loading = false;
      setResources({
        projectId,
        connections: connections.ok ? connections.value.map(({ id, name, type }) => ({ id, name, type })) : [],
        secrets: secrets.ok ? secrets.value.map(s => s.name) : [],
        variables: variables.ok ? variables.value.map(({ name, value }) => ({ name, value })) : [],
        flows: contents.ok ? contents.value.flows.filter(f => !f.archivedAt).map(({ id, name }) => ({ id, name })) : [],
      });
    });
  }, [projectId]);
  useEffect(() => {
    load();
    return () => {
      loaded.current = { projectId: '', at: 0, loading: false };
    };
  }, [load]);

  return useMemo(() => ({ ...resources, refresh: load }), [resources, load]);
}
