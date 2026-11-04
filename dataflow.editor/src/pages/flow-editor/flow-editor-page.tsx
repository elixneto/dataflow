import { useEffect, useState } from 'react';
import { useParams } from 'react-router';
import type { Flow, Folder } from '@/data/flows/flow';
import { getFlow, getProjectContents } from '@/data/flows/flows-api';
import { folderPath } from '@/data/flows/project-tree';
import { useProject } from '@/data/projects/use-project';
import { ConnectionStatus } from '@/layout/connection-status';
import { ThemeToggle } from '@/layout/theme-toggle';
import { ProjectBreadcrumb } from '@/pages/project-flows/project-breadcrumb';
import { FlowCanvas } from './flow-canvas';

type Loaded = { for: string; flow: Flow | null; folders: Folder[] };

/**
 * A flow (/projects/:projectId/flows/:flowId), on the whole screen: no sidebar, the breadcrumb (project, folders, flow) in the
 * top bar, and the canvas below. Outside the AppShell (see router.tsx).
 */
export function FlowEditorPage() {
  const { projectId = '', flowId = '' } = useParams();
  const project = useProject(projectId);
  const [loaded, setLoaded] = useState<Loaded | null>(null);

  useEffect(() => {
    let current = true;
    void Promise.all([getFlow(flowId), getProjectContents(projectId)]).then(([flow, contents]) => {
      if (current) {
        const found = flow.ok ? flow.value : null;
        const folders = found && contents.ok ? folderPath(contents.value.folders, found.folderId) : [];
        setLoaded({ for: flowId, flow: found, folders });
      }
    });

    return () => {
      current = false;
    };
  }, [flowId, projectId]);

  const current = loaded?.for === flowId ? loaded : null;
  const flowName = current ? (current.flow?.name ?? 'Flow not found') : '';

  return (
    <div className="flex h-svh flex-col">
      {/* same height and border as the app's top bar */}
      <header className="flex h-14 shrink-0 items-center gap-2 border-b bg-background px-4">
        <ProjectBreadcrumb project={project.status === 'ready' ? project.project : null} folders={current?.folders} flowName={flowName} />
        <div className="ml-auto flex shrink-0 items-center gap-1">
          <ConnectionStatus />
          <ThemeToggle />
        </div>
      </header>
      <main className="relative min-h-0 flex-1">
        {current && !current.flow ? (
          <div className="flex h-full items-center justify-center text-sm text-muted-foreground">Flow not found.</div>
        ) : (
          <FlowCanvas />
        )}
      </main>
    </div>
  );
}
