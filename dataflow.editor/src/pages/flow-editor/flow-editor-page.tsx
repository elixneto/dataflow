import { useEffect, useRef, useState } from 'react';
import { flowFileName, flowToYaml } from '@dataflow/core';
import { canvasToFlowFile, saveFile } from '@/editor/flow-file';
import { useParams } from 'react-router';
import type { Flow, Folder } from '@/data/flows/flow';
import { getFlow, getProjectContents } from '@/data/flows/flows-api';
import { folderPath } from '@/data/flows/project-tree';
import { useProject } from '@/data/projects/use-project';
import { ConnectionStatus } from '@/layout/connection-status';
import { ThemeToggle } from '@/layout/theme-toggle';
import { ProjectBreadcrumb } from '@/pages/project-flows/project-breadcrumb';
import { ServerGate } from '@/components/server-gate';
import { FlowActions } from './flow-actions';
import { FlowCanvas, type CanvasExport } from './flow-canvas';

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
  // Download: the canvas as it is now, as the core's YAML flow file
  const canvas = useRef<CanvasExport | null>(null);
  const download = () => {
    const now = canvas.current?.();
    if (!now || !current?.flow) {
      return;
    }

    const file = canvasToFlowFile({ id: current.flow.id, name: current.flow.name }, now.nodes, now.edges);
    saveFile(flowFileName(file.name), flowToYaml(file), 'application/yaml');
  };

  return (
    <div className="flex h-svh flex-col">
      {/* same height and border as the app's top bar */}
      <header className="flex h-14 shrink-0 items-center gap-2 border-b bg-background px-4">
        <ProjectBreadcrumb project={project.status === 'ready' ? project.project : null} folders={current?.folders} flowName={flowName} />
        <div className="ml-auto flex shrink-0 items-center gap-1">
          <FlowActions onDownload={current?.flow ? download : undefined} />
          <span className="mx-1 h-5 w-px bg-border" aria-hidden />
          <ConnectionStatus />
          <ThemeToggle />
        </div>
      </header>
      <main className="relative min-h-0 flex-1">
        {current && !current.flow ? (
          <div className="flex h-full items-center justify-center text-sm text-muted-foreground">Flow not found.</div>
        ) : (
          // the canvas saves as it goes: while the server is away it is blurred and blocked, so nothing is lost
          <ServerGate>
            <FlowCanvas exportRef={canvas} />
          </ServerGate>
        )}
      </main>
    </div>
  );
}
