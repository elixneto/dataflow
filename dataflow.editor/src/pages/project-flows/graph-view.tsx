import { useEffect, useMemo, useState } from 'react';
import { Background, BackgroundVariant, Controls, Handle, MarkerType, Position, ReactFlow, ReactFlowProvider, useReactFlow, type Edge, type Node, type NodeProps } from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { ExternalLink, Search, X } from 'lucide-react';
import { flowPath } from '@/app/paths';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { loadProjectCalls, useProjectCalls } from '@/editor/project-calls';
import { cn } from '@/lib/utils';
import { callsGraph, NODE_HEIGHT, NODE_WIDTH, reached, type GraphFlow } from './calls-graph';

/**
 * The calls between the project's flows (Flows › Graph): a box per flow that calls or is called, inside its folder's
 * box, an arrow from the caller to the called flow; red where a chain comes back (circular), dashed where the call is
 * only made on another call's error, grey and dashed to a flow that is archived or removed. Clicking a flow shows its
 * impact: what depends on it (calls it, directly or down the chain) and what it uses, the rest faded. The search finds
 * a flow by name. Each box opens its flow in a new tab.
 */
export function GraphView({ projectId }: { projectId: string }) {
  return (
    <ReactFlowProvider>
      <Graph projectId={projectId} />
    </ReactFlowProvider>
  );
}

type FlowData = { flow: GraphFlow; projectId: string; role?: 'selected' | 'dependent' | 'used' | 'faded'; match?: boolean };

function Graph({ projectId }: { projectId: string }) {
  const data = useProjectCalls(projectId);
  // the graph shows the calls as they are now: read again when it opens
  useEffect(() => loadProjectCalls(projectId, true), [projectId]);
  const [selected, setSelected] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const { setCenter } = useReactFlow();
  const graph = useMemo(() => (data ? callsGraph(data) : null), [data]);

  const impact = useMemo(() => {
    if (!graph || !selected) {
      return null;
    }
    return { dependents: reached(graph.calls, selected, 'usedBy'), uses: reached(graph.calls, selected, 'uses') };
  }, [graph, selected]);

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q && graph ? graph.flows.filter(f => f.name.toLowerCase().includes(q)) : [];
  }, [graph, query]);

  if (!graph) {
    return <p className="text-sm text-muted-foreground">Reading the calls…</p>;
  }

  if (graph.flows.length === 0) {
    return <p className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">No flow calls another one yet (a Flow Invoker does).</p>;
  }

  const roleOf = (id: string): FlowData['role'] =>
    !impact ? undefined : id === selected ? 'selected' : impact.dependents.has(id) ? 'dependent' : impact.uses.has(id) ? 'used' : 'faded';
  const nodes: Node[] = [
    ...graph.folders.map(
      (folder): Node => ({
        id: `folder:${folder.name}`,
        type: 'folder',
        position: { x: folder.x, y: folder.y },
        data: { name: folder.name },
        style: { width: folder.width, height: folder.height },
        draggable: false,
        selectable: false,
        zIndex: -1,
      }),
    ),
    ...graph.flows.map(
      (flow): Node => ({
        id: flow.id,
        type: 'flow',
        position: { x: flow.x, y: flow.y },
        data: { flow, projectId, role: roleOf(flow.id), match: matches.some(m => m.id === flow.id) } satisfies FlowData,
        draggable: false,
        connectable: false,
      }),
    ),
  ];
  const faded = (id: string) => roleOf(id) === 'faded';
  const at = new Map(graph.flows.map(f => [f.id, f]));
  const edges: Edge[] = graph.calls.map(call => {
    const unavailable = !at.get(call.to)?.available;
    const color = call.circular ? 'var(--destructive)' : unavailable ? 'var(--muted-foreground)' : undefined;
    // a call back to a flow on the left (a cycle closing, or a flow calling itself) goes under the boxes, not behind them
    const back = (at.get(call.to)?.x ?? 0) <= (at.get(call.from)?.x ?? 0);
    return {
      id: call.id,
      source: call.from,
      target: call.to,
      sourceHandle: back ? 'back-out' : 'out',
      targetHandle: back ? 'back-in' : 'in',
      ...(back ? { type: 'smoothstep', pathOptions: { offset: 28, borderRadius: 12 } } : {}),
      label: call.label,
      markerEnd: { type: MarkerType.ArrowClosed, ...(color ? { color } : {}) },
      style: { ...(color ? { stroke: color } : {}), ...(call.onError || unavailable ? { strokeDasharray: '6 4' } : {}), ...(call.circular ? { strokeWidth: 2 } : {}) },
      className: cn(impact && (faded(call.from) || faded(call.to)) && 'opacity-20'),
    };
  });

  const focus = (flow: GraphFlow) => {
    setSelected(flow.id);
    void setCenter(flow.x + NODE_WIDTH / 2, flow.y + NODE_HEIGHT / 2, { zoom: 1, duration: 300 });
  };
  const chosen = selected ? graph.flows.find(f => f.id === selected) : undefined;
  // as tall as the graph needs (a few flows: no empty band under them), at most most of the screen
  const tall = Math.max(...graph.flows.map(f => f.y + NODE_HEIGHT), ...graph.folders.map(f => f.y + f.height)) - Math.min(...graph.flows.map(f => f.y), ...graph.folders.map(f => f.y));

  return (
    <div className="grid gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative w-64">
          <Search className="pointer-events-none absolute top-1/2 left-2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <Input
            aria-label="Find a flow"
            placeholder="Find a flow"
            className="h-8 pl-8"
            value={query}
            onChange={event => setQuery(event.target.value)}
            onKeyDown={event => {
              if (event.key === 'Enter' && matches[0]) {
                focus(matches[0]);
              }
            }}
          />
        </div>
        {query.trim() && <span className="text-xs text-muted-foreground">{matches.length === 0 ? 'No flow by that name in the graph' : `${matches.length} found: Enter shows the first`}</span>}
        {chosen && impact && (
          <span className="ml-auto flex items-center gap-2 text-xs">
            <span className="font-medium">{chosen.name}</span>
            <span className="text-amber-700 dark:text-amber-400">{impact.dependents.size} depend on it</span>
            <span className="text-sky-700 dark:text-sky-400">uses {impact.uses.size}</span>
            <Button variant="ghost" size="icon-sm" aria-label="Clear the selection" onClick={() => setSelected(null)}>
              <X />
            </Button>
          </span>
        )}
      </div>
      <div className="calls-graph overflow-hidden rounded-lg border [&_.react-flow__edge-text]:text-[11px]" style={{ height: `min(65vh, ${Math.max(260, tall + 140)}px)` }}>
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={NODE_TYPES}
          fitView
          fitViewOptions={{ padding: 0.06, maxZoom: 1 }}
          nodesDraggable={false}
          nodesConnectable={false}
          edgesFocusable={false}
          proOptions={{ hideAttribution: true }}
          onNodeClick={(_, node) => node.type === 'flow' && setSelected(current => (current === node.id ? null : node.id))}
          onPaneClick={() => setSelected(null)}
        >
          <Background variant={BackgroundVariant.Dots} gap={20} />
          <Controls position="bottom-left" showInteractive={false} />
        </ReactFlow>
      </div>
      <p className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
        <span>Click a flow: what depends on it (amber) and what it uses (blue).</span>
        <span className="text-destructive">Red: a circular call, it fails.</span>
        <span>Dashed: only on another call's error, or to an archived or removed flow.</span>
      </p>
    </div>
  );
}

/** a flow's box: its name and folder; the icon opens it in a new tab (a middle click too) */
function FlowNode({ data }: NodeProps<Node<FlowData>>) {
  const { flow, projectId, role, match } = data;
  return (
    <div
      className={cn(
        'flex h-14 w-[220px] items-center gap-2 rounded-md border bg-card px-3 text-left shadow-sm transition-opacity',
        !flow.available && 'border-dashed text-muted-foreground',
        role === 'selected' && 'border-2 border-primary',
        role === 'dependent' && 'border-amber-500 bg-amber-50 dark:bg-amber-950/40',
        role === 'used' && 'border-sky-500 bg-sky-50 dark:bg-sky-950/40',
        role === 'faded' && 'opacity-25',
        match && 'ring-2 ring-ring',
      )}
      title={flow.available ? 'Click: its impact' : flow.known ? 'Archived: each call to it fails' : 'Removed: each call to it fails'}
    >
      <Handle id="in" type="target" position={Position.Left} className="opacity-0" isConnectable={false} />
      <Handle id="back-in" type="target" position={Position.Bottom} style={{ left: '30%' }} className="opacity-0" isConnectable={false} />
      <div className="flex min-w-0 flex-1 flex-col">
        <span className={cn('truncate text-sm font-medium', !flow.known && 'text-destructive', flow.known && !flow.available && 'line-through')}>{flow.name}</span>
        <span className="truncate text-xs text-muted-foreground">{!flow.known ? 'Removed' : !flow.available ? 'Archived' : flow.folder || 'Flows (root)'}</span>
      </div>
      {flow.known && (
        <a
          href={flowPath(projectId, flow.id)}
          target="_blank"
          rel="noopener"
          aria-label={`Open ${flow.name} in a new tab`}
          title="Open in a new tab"
          className="nodrag nopan rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
          onClick={event => event.stopPropagation()}
        >
          <ExternalLink className="size-3.5" />
        </a>
      )}
      <Handle id="out" type="source" position={Position.Right} className="opacity-0" isConnectable={false} />
      <Handle id="back-out" type="source" position={Position.Bottom} style={{ left: '70%' }} className="opacity-0" isConnectable={false} />
    </div>
  );
}

/** a folder's box behind its flows, its name on top */
function FolderNode({ data }: NodeProps<Node<{ name: string }>>) {
  return (
    <div className="pointer-events-none size-full rounded-lg border border-dashed bg-muted/30">
      <span className="block truncate px-2 pt-1 text-xs font-medium text-muted-foreground">{data.name}</span>
    </div>
  );
}

const NODE_TYPES = { flow: FlowNode, folder: FolderNode };
