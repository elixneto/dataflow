import {useEffect, useRef, useState} from 'react';
import {Link} from 'react-router';
import {GitFork} from 'lucide-react';
import {workflowDependencies, type ExecutableWorkflow, type WorkflowCall} from '@dataflow/core';
import {listFlows, type Flow} from '#mock/flows';
import {toExecutable} from '#run/runner';
import {Button} from '#ui/button';

/**
 * Dependencies of the flow: the workflows it calls (Workflow Invoker) and the ones that call it. `current` is the
 * flow as it is in the editor, so unsaved changes count too.
 */
export function DependenciesButton({current}: {current: () => Flow}) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent | KeyboardEvent) => {
      if (e instanceof KeyboardEvent ? e.key === 'Escape' : !box.current?.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener('mousedown', close);
    window.addEventListener('keydown', close);
    return () => {
      window.removeEventListener('mousedown', close);
      window.removeEventListener('keydown', close);
    };
  }, [open]);

  return (
    <div ref={box} className="relative">
      <Button variant="ghost" size="sm" onClick={() => setOpen(o => !o)} aria-expanded={open} title="Workflows it uses and that use it">
        <GitFork className="size-4" aria-hidden="true"/> Dependencies
      </Button>
      {open && <DependenciesPanel flow={current()}/>}
    </div>
  );
}

function DependenciesPanel({flow}: {flow: Flow}) {
  const flows = listFlows();
  const byId = new Map(flows.map(f => [f.id, f]));
  const executable = (f: Flow): ExecutableWorkflow => toExecutable(f.name, f.parameters ?? [], f.nodes, f.edges, f.id, f.projectId);
  const workflows = [...flows.filter(f => f.id !== flow.id).map(executable), executable(flow)];
  const {uses, usedBy} = workflowDependencies(workflows, flow.id);

  return (
    <div role="dialog" aria-label="Dependencies"
         className="absolute top-full right-0 z-50 mt-1 flex w-80 flex-col gap-3 rounded-md border border-border bg-popover p-3 text-sm text-popover-foreground shadow-md">
      <Section title="Uses" calls={uses} other={c => c.to} byId={byId} showNode/>
      <Section title="Used by" calls={usedBy} other={c => c.from} byId={byId}/>
    </div>
  );
}

function Section({title, calls, other, byId, showNode}: {
  title: string;
  calls: WorkflowCall[];
  /** the workflow on the other end of the call */
  other: (call: WorkflowCall) => string;
  byId: Map<string, Flow>;
  showNode?: boolean;
}) {
  return (
    <section className="flex flex-col gap-1">
      <h3 className="font-medium text-muted-foreground">{title}</h3>
      {calls.length === 0 && <p className="text-muted-foreground">None</p>}
      <ul className="flex flex-col gap-1">
        {calls.map(call => {
          const target = byId.get(other(call));
          return (
            <li key={`${call.from}:${call.nodeId}`} className="flex min-w-0 flex-col rounded px-2 py-1 hover:bg-accent">
              {target
                ? <Link to={`/projects/${target.projectId}/flows/${target.id}`} className="truncate font-medium hover:underline">{target.name}</Link>
                : <span className="truncate text-destructive" title={other(call)}>Not found</span>}
              <span className="truncate text-muted-foreground">
                {[target?.folder || (target ? 'Flows (root)' : other(call)), showNode ? `via ${call.nodeLabel}` : undefined].filter(Boolean).join(' · ')}
              </span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
