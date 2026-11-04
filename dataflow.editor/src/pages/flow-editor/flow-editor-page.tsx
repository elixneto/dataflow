import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
import { portLabel } from '@/editor/run/port-label';
import { ConfirmDialog, type ConfirmTarget } from '@/components/confirm-dialog';
import { cancelRun, getRun, startRun, type RunUsage } from '@/data/flows/flows-api';
import { followRun } from '@/data/flows/run-events';
import { knownVariablesAfter, writingComponents, type KnownVariables } from '@dataflow/core';
import { inputSamplesAfter, readInputSamples, readKnownVariables, rememberInputSamples, rememberKnownVariables, type InputSamples } from '@/editor/expression-variables';
import type { ApiResult } from '@/lib/api';
import { pinnedOutput, runMarks } from '@/editor/run/run-marks';
import { componentInfo } from '@/editor/catalog';
import type { RunProgress, RunRecord } from '@dataflow/core';

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

  // a run on the server, of the saved draft (what is pending is saved first), followed until it ends
  const [running, setRunning] = useState<'test' | 'real' | null>(null);
  // the run going on (Stop), and whether Stop was asked
  const [runId, setRunId] = useState<string | null>(null);
  const [stopping, setStopping] = useState(false);
  // the run's record: as it goes (RunProgress) while it runs, then the final one
  const [record, setRecord] = useState<RunRecord | RunProgress | null>(null);
  // the last full test run (not a Run from here): Run from here is offered by what reached each component there
  const [fullRun, setFullRun] = useState<RunRecord | null>(null);
  // what the run's worker process used, once it ended
  const [usage, setUsage] = useState<RunUsage | null>(null);
  // what the runs of this flow saw at each port: the expression fields suggest it
  const [known, setKnown] = useState<{ flowId: string; variables: KnownVariables }>(() => ({ flowId, variables: readKnownVariables(flowId) }));
  const knownNow = known.flowId === flowId ? known.variables : readKnownVariables(flowId);
  const [samples, setSamples] = useState<{ flowId: string; samples: InputSamples }>(() => ({ flowId, samples: readInputSamples(flowId) }));
  const samplesNow = samples.flowId === flowId ? samples.samples : readInputSamples(flowId);
  const [runError, setRunError] = useState('');
  const [panelOpen, setPanelOpen] = useState(false);
  const [confirm, setConfirm] = useState<ConfirmTarget | null>(null);
  // a port's count clicked on the canvas: the panel shows it
  const [show, setShow] = useState<{ nodeId: string; port: string; at: number } | null>(null);
  // fromNodeId: Run from here (that component and what follows it, from what reached it in the last run)
  const execute = async (kind: 'test' | 'real', fromNodeId?: string): Promise<ApiResult<unknown>> => {
    if (!current?.flow || running) {
      return { ok: true, value: null };
    }

    setRunning(kind);
    setRunId(null);
    setStopping(false);
    setRunError('');
    setShow(null);
    setPanelOpen(true);
    const fail = (message: string): ApiResult<unknown> => {
      setRunError(message);
      setRunning(null);
      return { ok: true, value: null };
    };
    if (save && !(await save.flush())) {
      return fail('The flow could not be saved, so it did not run.');
    }

    // Run from here: the component's name as the canvas shows it (the record and its first log line say it)
    const fromNode = fromNodeId ? canvas.current?.snapshot().nodes.find(n => n.id === fromNodeId) : undefined;
    const fromData = fromNode?.data as { type?: string; label?: string } | undefined;
    const from = fromNodeId ? { nodeId: fromNodeId, label: fromData?.label?.trim() || componentInfo(fromData?.type ?? '')?.label || fromNodeId } : undefined;
    const started = await startRun(current.flow.id, kind === 'real' ? 'execution' : 'validation', from);
    if (!started.ok) {
      return fail(started.error.message);
    }

    setRunId(started.value.id);
    // the run so far as it goes (SSE), each component as it ends; if the stream fails, asked every half second
    const ended = (final: RunRecord, used: RunUsage | null) => {
      setRecord(final);
      // a full test run is what Run from here starts from (the server keeps it beside the Run from here)
      if (final.run.mode === 'validation' && !final.from) {
        setFullRun(final);
      }

      setUsage(used);
      const variables = knownVariablesAfter(knownNow, final);
      rememberKnownVariables(flowId, variables);
      setKnown({ flowId, variables });
      const seen = inputSamplesAfter(samplesNow, final);
      rememberInputSamples(flowId, seen);
      setSamples({ flowId, samples: seen });
      setRunning(null);
      return { ok: true, value: null } as const;
    };
    setRecord(null);
    setUsage(null);
    const followed = await followRun(started.value.id, setRecord);
    if (followed) {
      return ended(followed.record, followed.usage);
    }

    for (;;) {
      const run = await getRun(started.value.id);
      if (!run.ok) {
        return fail(run.error.message);
      }

      if (run.value.status !== 'queued' && run.value.status !== 'running') {
        if (run.value.record && run.value.record.status !== 'running') {
          return ended(run.value.record, run.value.usage);
        }

        setRunning(null);
        return { ok: true, value: null };
      }

      if (run.value.record) {
        setRecord(run.value.record);
      }

      await new Promise(resolve => setTimeout(resolve, 500));
    }
  };
  // Run for real lists what is going to write outside the flow and asks first (a test run writes nothing)
  const run = (kind: 'test' | 'real') => {
    const now = canvas.current?.snapshot();
    if (!now || !current?.flow || running) {
      return;
    }

    if (kind === 'test') {
      void execute('test');
      return;
    }

    const writers = writingComponents(canvasToFlowFile({ id: current.flow.id, name: current.flow.name }, now.nodes, now.edges));
    setConfirm({
      title: 'Run for real?',
      description: writers.length
        ? `These components write outside the flow: ${writers.map(n => n.label || n.type).join(', ')}.`
        : 'No component writes outside the flow.',
      confirmLabel: 'Run for real',
      busyLabel: 'Starting…',
      destructive: writers.length > 0,
      onConfirm: async () => {
        setConfirm(null);
        void execute('real');
        return { ok: true, value: null };
      },
    });
  };
  const stop = async () => {
    if (!runId || stopping) {
      return;
    }

    setStopping(true);
    const result = await cancelRun(runId);
    if (!result.ok) {
      setStopping(false);
    }
  };
  // the canvas' Run from here calls the latest execute; the callback stays the same, so the marks do too
  const executeRef = useRef(execute);
  useEffect(() => {
    executeRef.current = execute;
  });
  const runFrom = useCallback((nodeId: string) => void executeRef.current('test', nodeId), []);
  const [pinned, setPinned] = useState<string[]>([]);
  // what the canvas shows of the run (the same object while nothing changes: every component reads it)
  const marks = useMemo(
    () =>
      panelOpen
        ? runMarks(
            record,
            running !== null,
            (nodeId, port) => setShow(previous => ({ nodeId, port, at: (previous?.at ?? 0) + 1 })),
            fullRun,
          )
        : null,
    [panelOpen, record, running, fullRun],
  );

  return (
    <div className="flex h-svh flex-col">
      {/* the browser tab says which flow it is (React puts it in the head; leaving the page gives the app's back) */}
      {current?.flow && <title>{`Flow :: ${current.flow.name}`}</title>}
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
                <FlowCanvas exportRef={canvas} onSave={setSave} onRunFrom={runFrom} onPinned={setPinned} marks={marks} known={knownNow} inputSamples={samplesNow} />
              </div>
              {panelOpen && (
                <RunPanel
                  record={record}
                  usage={usage}
                  running={running}
                  // until the first progress: waiting for a free worker
                  queued={running !== null && record === null}
                  onStop={runId ? () => void stop() : undefined}
                  stopping={stopping}
                  onFocus={id => canvas.current?.focus(id)}
                  pinned={new Set(pinned)}
                  onPin={(id, on) => canvas.current?.setPinned(id, on ? pinnedOutput(record?.components.find(c => c.nodeId === id)) : undefined)}
                  onClose={() => setPanelOpen(false)}
                  show={show}
                  error={runError}
                  // a port's name with the node's config (a Router's cases), from the canvas as it is
                  portName={(nodeId, type, port) => {
                    const node = canvas.current?.snapshot().nodes.find(n => n.id === nodeId);
                    return portLabel(type, node?.type === 'component' ? (node.data as { config: Record<string, unknown> }).config : {}, port);
                  }}
                />
              )}
            </div>
          </ServerGate>
        )}
      </main>
      <ConfirmDialog target={confirm} onClose={() => setConfirm(null)} />
    </div>
  );
}
