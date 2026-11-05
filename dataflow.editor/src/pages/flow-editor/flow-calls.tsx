import { useState, type ReactNode } from 'react';
import { Link } from 'react-router';
import { Popover } from 'radix-ui';
import { CircleAlert, GitFork, RefreshCw } from 'lucide-react';
import { callPath, callTree, MAX_FLOW_DEPTH, type CallTreeNode, type FlowCall } from '@dataflow/core';
import { Button } from '@/components/ui/button';
import type { FlowCalls } from '@/data/flows/flows-api';
import { loadProjectCalls, useProjectCalls, withOwnCalls } from '@/editor/project-calls';
import { cn } from '@/lib/utils';

type Named = FlowCalls['flows'][number];

/**
 * The flows this flow calls (its Flow Invokers, and theirs, down the chain) and the ones that call it, in the top bar:
 * "Calls 2 · Called by 1", a circle in red when a chain comes back to it. Opening it reads the calls again, with this
 * flow's own as the canvas has them now (`ownCalls`).
 */
export function FlowCallsButton({ projectId, flowId, ownCalls }: { projectId: string; flowId: string; ownCalls: () => FlowCall[] | null }) {
  const data = useProjectCalls(projectId);
  const [own, setOwn] = useState<FlowCall[] | null>(null);
  const open = (next: boolean) => {
    if (next) {
      loadProjectCalls(projectId, true);
      setOwn(ownCalls());
    }
  };
  const calls = withOwnCalls(data?.calls ?? [], flowId, own);
  const uses = calls.filter(c => c.from === flowId);
  const usedBy = calls.filter(c => c.to === flowId && c.from !== flowId);
  const circular = uses.some(c => c.to === flowId || callPath(calls, c.to, flowId));
  return (
    <Popover.Root onOpenChange={open}>
      <Popover.Trigger asChild>
        <Button variant="ghost" size="sm" title={circular ? 'A chain of calls comes back to this flow: those calls fail' : 'The flows it calls and the ones that call it'}>
          <GitFork className={cn(circular && 'text-destructive')} />
          <span className="font-mono text-xs">
            Calls {data ? new Set(uses.map(c => c.to)).size : '…'} · Called by {data ? new Set(usedBy.map(c => c.from)).size : '…'}
          </span>
          {circular && <CircleAlert className="text-destructive" aria-label="circular call" />}
        </Button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content align="end" sideOffset={6} className="z-50 max-h-[70vh] w-[28rem] overflow-auto rounded-md border bg-popover p-3 text-sm text-popover-foreground shadow-md">
          {data ? <FlowCallsView projectId={projectId} flowId={flowId} data={data} calls={calls} /> : <p className="text-muted-foreground">Reading the calls…</p>}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

/** what the popover shows: the call tree (Calls) and the callers (Called by) */
export function FlowCallsView({ projectId, flowId, data, calls }: { projectId: string; flowId: string; data: FlowCalls; calls: FlowCall[] }) {
  const byId = new Map(data.flows.map(f => [f.id, f]));
  const nameOf = (id: string) => byId.get(id)?.name ?? 'Not found';
  const tree = callTree(calls, flowId);
  const callers = calls.filter(c => c.to === flowId && c.from !== flowId);
  return (
    <div className="grid gap-3">
      <section className="grid gap-1">
        <h3 className="flex items-center justify-between font-medium">
          Calls
          <span className="text-xs font-normal text-muted-foreground">up to {MAX_FLOW_DEPTH} levels</span>
        </h3>
        {tree.nodes.length === 0 ? <p className="text-xs text-muted-foreground">No Flow Invoker calls another flow.</p> : <CallRows nodes={tree.nodes} projectId={projectId} byId={byId} nameOf={nameOf} />}
        {tree.truncated && <p className="text-xs text-muted-foreground">Cut short: too many calls to show.</p>}
      </section>
      <section className="grid gap-1">
        <h3 className="font-medium">Called by</h3>
        {callers.length === 0 && <p className="text-xs text-muted-foreground">No flow calls this one.</p>}
        <ul aria-label="Called by" className="grid gap-0.5">
          {callers.map(c => (
            <li key={`${c.from}:${c.nodeId}`}>
              <FlowLink projectId={projectId} flow={byId.get(c.from)} id={c.from} detail={`via ${c.nodeLabel}${c.onErrorOfLabel ? ` · on error of ${c.onErrorOfLabel}` : ''}`} />
            </li>
          ))}
        </ul>
      </section>
      <p className="flex items-center gap-1 text-xs text-muted-foreground">
        <RefreshCw className="size-3" aria-hidden /> From the drafts as saved, this flow as it is on the canvas.
      </p>
    </div>
  );
}

function CallRows({ nodes, projectId, byId, nameOf }: { nodes: CallTreeNode[]; projectId: string; byId: Map<string, Named>; nameOf: (id: string) => string }) {
  return (
    <ul className="grid gap-0.5">
      {nodes.map(node => {
        const { call } = node;
        const notes = [
          `via ${call.nodeLabel}`,
          call.onErrorOfLabel ? `on error of ${call.onErrorOfLabel}` : '',
        ].filter(Boolean);
        return (
          <li key={`${call.from}:${call.nodeId}`} style={{ paddingLeft: `${(node.depth - 1) * 1}rem` }}>
            <FlowLink projectId={projectId} flow={byId.get(call.to)} id={call.to} detail={notes.join(' · ')} depth={node.depth}>
              {node.cycle && (
                <span className="text-destructive">
                  Circular: back to {nameOf(call.to)}; each call fails
                </span>
              )}
              {node.tooDeep && <span className="text-destructive">Past {MAX_FLOW_DEPTH} levels: the call fails</span>}
            </FlowLink>
            {node.children.length > 0 && <CallRows nodes={node.children} projectId={projectId} byId={byId} nameOf={nameOf} />}
          </li>
        );
      })}
    </ul>
  );
}

/** a flow on the other end of a call: its name (a link), its folder and how it is called; a removed or archived one says so */
function FlowLink(props: { projectId: string; flow: Named | undefined; id: string; detail: string; depth?: number; children?: ReactNode }) {
  const { projectId, flow, id, detail, depth, children } = props;
  const where = flow ? (flow.available ? flow.folder || 'Flows (root)' : 'Archived: each call fails') : 'Removed: each call fails';
  return (
    <div className="flex min-w-0 flex-col rounded px-2 py-1 hover:bg-accent">
      <span className="flex min-w-0 items-center gap-2">
        {depth !== undefined && depth > 1 && <span className="font-mono text-xs text-muted-foreground">{depth}</span>}
        {flow ? (
          <Link to={`/projects/${projectId}/flows/${id}`} className={cn('truncate font-medium hover:underline', !flow.available && 'text-muted-foreground line-through')}>
            {flow.name}
          </Link>
        ) : (
          <span className="truncate font-medium text-destructive" title={id}>
            Not found
          </span>
        )}
      </span>
      <span className={cn('truncate text-xs text-muted-foreground', (!flow || !flow.available) && 'text-destructive')}>
        {where} · {detail}
      </span>
      {children && <span className="text-xs">{children}</span>}
    </div>
  );
}
