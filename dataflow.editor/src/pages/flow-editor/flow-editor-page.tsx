import { useEffect, useMemo, useRef, useState } from 'react';
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
import { SaveStatus } from './save-status';
import type { DraftSave } from '@/editor/flow-save';
import { FlowCanvas, type CanvasHandle } from './flow-canvas';
import { RunPanel } from './run-panel';
import { mockRunRecord } from '@/editor/run/mock-run';
import { runMarks } from '@/editor/run/run-marks';
import type { RunRecord } from '@dataflow/core';

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
  const canvas = useRef<CanvasHandle | null>(null);
  // the draft's save state, from the canvas (shown in the top bar)
  const [save, setSave] = useState<DraftSave | null>(null);
  const download = () => {
    const now = canvas.current?.snapshot();
    if (!now || !current?.flow) {
      return;
    }

    const file = canvasToFlowFile({ id: current.flow.id, name: current.flow.name }, now.nodes, now.edges);
    saveFile(flowFileName(file.name), flowToYaml(file), 'application/yaml');
  };

  // MOCK: a run makes up its record from the flow as it is (editor/run/mock-run.ts) after a moment
  const [running, setRunning] = useState<'test' | 'real' | null>(null);
  const [record, setRecord] = useState<RunRecord | null>(null);
  const [panelOpen, setPanelOpen] = useState(false);
  const run = (kind: 'test' | 'real') => {
    const now = canvas.current?.snapshot();
    if (!now || !current?.flow || running) {
      return;
    }

    const file = canvasToFlowFile({ id: current.flow.id, name: current.flow.name }, now.nodes, now.edges);
    setRunning(kind);
    setShow(null);
    setPanelOpen(true);
    window.setTimeout(() => {
      setRecord(mockRunRecord(file, kind === 'real' ? 'execution' : 'validation'));
      setRunning(null);
    }, 900);
  };
  const [pinned, setPinned] = useState<string[]>([]);
  // a port's count clicked on the canvas: the panel shows it
  const [show, setShow] = useState<{ nodeId: string; port: string; at: number } | null>(null);
  // what the canvas shows of the run (the same object while nothing changes: every component reads it)
  const marks = useMemo(
    () => (panelOpen ? runMarks(record, running !== null, (nodeId, port) => setShow(previous => ({ nodeId, port, at: (previous?.at ?? 0) + 1 }))) : null),
    [panelOpen, record, running],
  );

  return (
    <div className="flex h-svh flex-col">
      {/* same height and border as the app's top bar */}
      <header className="flex h-14 shrink-0 items-center gap-2 border-b bg-background px-4">
        <ProjectBreadcrumb project={project.status === 'ready' ? project.project : null} folders={current?.folders} flowName={flowName} />
        <div className="ml-auto flex shrink-0 items-center gap-1">
          <SaveStatus save={save} />
          <span className="mx-1 h-5 w-px bg-border" aria-hidden />
          <FlowActions onDownload={current?.flow ? download : undefined} running={running} onRun={current?.flow ? run : undefined} />
          <span className="mx-1 h-5 w-px bg-border" aria-hidden />
          <ConnectionStatus />
          <ThemeToggle />
        </div>
      </header>
      <main className="relative flex min-h-0 flex-1 flex-col">
        {current && !current.flow ? (
          <div className="flex h-full items-center justify-center text-sm text-muted-foreground">Flow not found.</div>
        ) : (
          // the canvas saves as it goes: while the server is away it is blurred and blocked, so nothing is lost
          <ServerGate>
            {/* the canvas over the run's panel: the panel takes its height from the bottom, the canvas (with its tray,
                zoom and minimap) the rest */}
            <div className="flex h-full flex-col">
              <div className="relative min-h-0 flex-1">
                <FlowCanvas exportRef={canvas} onSave={setSave} onPinned={setPinned} marks={marks} />
              </div>
              {panelOpen && (
                <RunPanel
                  record={record}
                  running={running}
                  onFocus={id => canvas.current?.focus(id)}
                  pinned={new Set(pinned)}
                  onPin={(id, on) => canvas.current?.setPinned(id, on)}
                  onClose={() => setPanelOpen(false)}
                  show={show}
                />
              )}
            </div>
          </ServerGate>
        )}
      </main>
    </div>
  );
}
