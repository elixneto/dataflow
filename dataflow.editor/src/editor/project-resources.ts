import { createContext, useContext, useEffect, useState } from 'react';
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
};

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
 * Loads the project's connections and secrets for the flow editor, and again when the window comes back into focus
 * (a connection or flow created in another tab shows up in the pickers).
 */
export function useLoadProjectResources(projectId: string): ProjectResources {
  const [resources, setResources] = useState<ProjectResources>({ projectId, connections: [], secrets: [], variables: [], flows: [] });
  useEffect(() => {
    let alive = true;
    const load = () => {
      void Promise.all([listConnections(projectId), listSecrets(projectId), getProjectContents(projectId), listVariables(projectId)]).then(([connections, secrets, contents, variables]) => {
        if (!alive) {
          return;
        }

        setResources({
          projectId,
          connections: connections.ok ? connections.value.map(({ id, name, type }) => ({ id, name, type })) : [],
          secrets: secrets.ok ? secrets.value.map(s => s.name) : [],
          variables: variables.ok ? variables.value.map(({ name, value }) => ({ name, value })) : [],
          flows: contents.ok ? contents.value.flows.filter(f => !f.archivedAt).map(({ id, name }) => ({ id, name })) : [],
        });
      });
    };
    load();
    window.addEventListener('focus', load);
    return () => {
      alive = false;
      window.removeEventListener('focus', load);
    };
  }, [projectId]);

  return resources;
}
