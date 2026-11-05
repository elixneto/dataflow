import { useEffect, useMemo, useState } from 'react';
import { Background, BackgroundVariant, BaseEdge, Controls, Handle, type EdgeProps, MarkerType, Position, ReactFlow, ReactFlowProvider, useReactFlow, type Edge, type Node, type NodeProps } from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { ExternalLink, FileCode2, Search, X } from 'lucide-react';
import { flowPath, scriptPath } from '@/app/paths';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { loadProjectCalls, useProjectCalls } from '@/editor/project-calls';
import { cn } from '@/lib/utils';
import { readGraphScripts, saveGraphScripts } from '@/lib/view-preference';
import { callsGraph, NODE_HEIGHT, NODE_WIDTH, reached, SCRIPT_HEIGHT, shortLabel, type GraphFlow, type GraphScript } from './calls-graph';

/**
 * The project's dependencies (Flows › Graph): a box per flow that calls or is called, inside its folder's box, an arrow
 * from the caller to the called flow; red where a chain comes back (circular), dashed where the call is only made on
 * another call's error, grey and dashed to a flow that is archived or removed. With Scripts (remembered): a violet box
 * per script a flow uses or a script imports, a violet arrow from the flow (its TypeScript components, its Start's input
 * type) and from the importing script. Clicking a box shows its impact: what depends on it (directly or down the chain)
 * and what it uses, the rest faded. The search finds a flow by name or a script by path. Each box opens it in a new tab.
 */
export function GraphView({ projectId }: { projectId: string }) {
  return (
    <ReactFlowProvider>
      <Graph projectId={projectId} />
    </ReactFlowProvider>
  );
}

type Role = 'selected' | 'dependent' | 'used' | 'faded';
type FlowData = { flow: GraphFlow; projectId: string; role?: Role; match?: boolean };
type ScriptData = { script: GraphScript; projectId: string; role?: Role; match?: boolean };

function Graph({ projectId }: { projectId: string }) {
  const data = useProjectCalls(projectId);
  // the graph shows the calls as they are now: read again when it opens
  useEffect(() => loadProjectCalls(projectId, true), [projectId]);
  const [selected, setSelected] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [withScripts, setWithScripts] = useState(readGraphScripts);
  const { setCenter } = useReactFlow();
  const graph = useMemo(() => (data ? callsGraph(data, { scripts: withScripts }) : null), [data, withScripts]);
  const toggleScripts = () => {
    setWithScripts(!withScripts);
    saveGraphScripts(!withScripts);
    setSelected(null);
  };

  const impact = useMemo(() => {
    if (!graph || !selected) {
      return null;
    }
    return { dependents: reached(graph.calls, selected, 'usedBy'), uses: reached(graph.calls, selected, 'uses') };
  }, [graph, selected]);

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q && graph
      ? [
          ...graph.flows.filter(f => f.name.toLowerCase().includes(q)).map(f => ({ id: f.id, x: f.x, y: f.y, height: NODE_HEIGHT })),
          ...graph.scripts.filter(s => s.path.toLowerCase().includes(q)).map(s => ({ id: s.id, x: s.x, y: s.y, height: SCRIPT_HEIGHT })),
        ]
      : [];
  }, [graph, query]);

  if (!graph) {
    return <p className="text-sm text-muted-foreground">Reading the calls…</p>;
  }

  const scriptsToggle = (
    <Button variant="outline" size="sm" aria-pressed={withScripts} className={cn(withScripts && 'border-violet-500 text-violet-700 dark:text-violet-300')} onClick={toggleScripts}>
      <FileCode2 /> Scripts
    </Button>
  );

  if (graph.flows.length === 0 && graph.scripts.length === 0) {
    return (
      <div className="grid gap-2">
        <div>{scriptsToggle}</div>
        <p className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
          {withScripts ? 'No flow calls another one or uses a script yet (a Flow Invoker, a TypeScript import or the Start\'s input type does).' : 'No flow calls another one yet (a Flow Invoker does).'}
        </p>
      </div>
    );
  }

  const roleOf = (id: string): Role | undefined =>
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
    ...graph.scripts.map(
      (script): Node => ({
        id: script.id,
        type: 'script',
        position: { x: script.x, y: script.y },
        data: { script, projectId, role: roleOf(script.id), match: matches.some(m => m.id === script.id) } satisfies ScriptData,
        draggable: false,
        connectable: false,
      }),
    ),
  ];
  const faded = (id: string) => roleOf(id) === 'faded';
  const at = new Map<string, { x: number; available: boolean }>([
    ...graph.flows.map(f => [f.id, f] as const),
    ...graph.scripts.map(s => [s.id, { x: s.x, available: s.known }] as const),
  ]);
  const edges: Edge[] = graph.calls.map(call => {
    const unavailable = !at.get(call.to)?.available;
    const color = call.circular
      ? 'var(--destructive)'
      : unavailable
        ? 'var(--muted-foreground)'
        : call.kind !== 'call'
          ? 'var(--color-violet-500)'
          : undefined;
    // a call back to a flow on the left (a cycle closing, or a flow calling itself) goes under the boxes, not behind them
    const back = (at.get(call.to)?.x ?? 0) <= (at.get(call.from)?.x ?? 0);
    return {
      id: call.id,
      source: call.from,
      target: call.to,
      sourceHandle: back ? 'back-out' : 'out',
      targetHandle: back ? 'back-in' : 'in',
      ...(back ? { type: 'smoothstep', pathOptions: { offset: 28, borderRadius: 12 } } : call.points ? { type: 'routed', data: { points: call.points } } : {}),
      // a long label cut short (its whole text on hover), so it stays between the boxes
      ...(call.label
        ? {
            label: (
              <tspan>
                <title>{call.label}</title>
                {shortLabel(call.label)}
              </tspan>
            ),
          }
        : {}),
      markerEnd: { type: MarkerType.ArrowClosed, ...(color ? { color } : {}) },
      style: { ...(color ? { stroke: color } : {}), ...(call.onError || unavailable ? { strokeDasharray: '6 4' } : {}), ...(call.circular ? { strokeWidth: 2 } : {}) },
      className: cn(impact && (faded(call.from) || faded(call.to)) && 'opacity-20'),
    };
  });

  const focus = (box: { id: string; x: number; y: number; height: number }) => {
    setSelected(box.id);
    void setCenter(box.x + NODE_WIDTH / 2, box.y + box.height / 2, { zoom: 1, duration: 300 });
  };
  const chosenName = selected ? (graph.flows.find(f => f.id === selected)?.name ?? graph.scripts.find(s => s.id === selected)?.path) : undefined;
  // as tall as the graph needs (a few flows: no empty band under them), at most most of the screen
  const boxes = [
    ...graph.flows.map(f => ({ y: f.y, bottom: f.y + NODE_HEIGHT })),
    ...graph.scripts.map(s => ({ y: s.y, bottom: s.y + SCRIPT_HEIGHT })),
    ...graph.folders.map(f => ({ y: f.y, bottom: f.y + f.height })),
  ];
  const tall = Math.max(...boxes.map(b => b.bottom)) - Math.min(...boxes.map(b => b.y));

  return (
    <div className="grid gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative w-64">
          <Search className="pointer-events-none absolute top-1/2 left-2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <Input
            aria-label={withScripts ? 'Find a flow or script' : 'Find a flow'}
            placeholder={withScripts ? 'Find a flow or script' : 'Find a flow'}
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
        {scriptsToggle}
        {query.trim() && <span className="text-xs text-muted-foreground">{matches.length === 0 ? 'Nothing by that name in the graph' : `${matches.length} found: Enter shows the first`}</span>}
        {chosenName && impact && (
          <span className="ml-auto flex items-center gap-2 text-xs">
            <span className="font-medium">{chosenName}</span>
            <span className="text-amber-700 dark:text-amber-400">{impact.dependents.size} depend on it</span>
            <span className="text-sky-700 dark:text-sky-400">uses {impact.uses.size}</span>
            <Button variant="ghost" size="icon-sm" aria-label="Clear the selection" onClick={() => setSelected(null)}>
              <X />
            </Button>
          </span>
        )}
      </div>
      <div className="calls-graph overflow-hidden rounded-lg border [&_.react-flow__edge-text]:text-xs" style={{ height: `min(75vh, ${Math.max(320, tall * 1.4 + 120)}px)` }}>
        <ReactFlow
          // with or without the scripts: fitted again
          key={withScripts ? 'scripts' : 'flows'}
          nodes={nodes}
          edges={edges}
          nodeTypes={NODE_TYPES}
          edgeTypes={EDGE_TYPES}
          fitView
          fitViewOptions={{ padding: 0.06, maxZoom: 1.4 }}
          nodesDraggable={false}
          nodesConnectable={false}
          edgesFocusable={false}
          proOptions={{ hideAttribution: true }}
          onNodeClick={(_, node) => node.type !== 'folder' && setSelected(current => (current === node.id ? null : node.id))}
          onPaneClick={() => setSelected(null)}
        >
          <Background variant={BackgroundVariant.Dots} gap={20} />
          <Controls position="bottom-left" showInteractive={false} />
        </ReactFlow>
      </div>
      <p className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
        <span>Click a box: what depends on it (amber) and what it uses (blue).</span>
        {withScripts && <span className="text-violet-700 dark:text-violet-300">Violet: a script a flow or another script uses.</span>}
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
        'flex h-16 w-[220px] items-center gap-2 rounded-md border bg-card px-3 text-left shadow-sm transition-opacity',
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
        <span className={cn('truncate text-base font-medium', !flow.known && 'text-destructive', flow.known && !flow.available && 'line-through')}>{flow.name}</span>
        <span className="truncate text-sm text-muted-foreground">{!flow.known ? 'Removed' : !flow.available ? 'Archived' : flow.folder || 'Flows (root)'}</span>
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

/** a script's box: its path; the icon opens it in the Scripts tab, in a new tab */
function ScriptNode({ data }: NodeProps<Node<ScriptData>>) {
  const { script, projectId, role, match } = data;
  const slash = script.path.lastIndexOf('/');
  return (
    <div
      className={cn(
        'flex h-12 w-[220px] items-center gap-2 rounded-md border border-violet-400 bg-violet-50 px-3 text-left shadow-sm transition-opacity dark:border-violet-700 dark:bg-violet-950/40',
        !script.known && 'border-dashed border-destructive bg-card dark:border-destructive dark:bg-card',
        role === 'selected' && 'border-2 border-primary dark:border-primary',
        role === 'dependent' && 'border-amber-500 bg-amber-50 dark:border-amber-500 dark:bg-amber-950/40',
        role === 'used' && 'border-sky-500 bg-sky-50 dark:border-sky-500 dark:bg-sky-950/40',
        role === 'faded' && 'opacity-25',
        match && 'ring-2 ring-ring',
      )}
      title={script.known ? `@myproject/scripts/${script.path} · Click: its impact` : 'Not found: no script at this path, each import of it fails'}
    >
      <Handle id="in" type="target" position={Position.Left} className="opacity-0" isConnectable={false} />
      <Handle id="back-in" type="target" position={Position.Bottom} style={{ left: '30%' }} className="opacity-0" isConnectable={false} />
      <FileCode2 className={cn('size-4 shrink-0', script.known ? 'text-violet-600 dark:text-violet-400' : 'text-destructive')} aria-hidden />
      <span className={cn('min-w-0 flex-1 truncate font-mono text-sm', !script.known && 'text-destructive')}>
        {slash > 0 && <span className="text-muted-foreground">{script.path.slice(0, slash + 1)}</span>}
        {script.path.slice(slash + 1)}
        {!script.known && ' · Not found'}
      </span>
      {script.known && (
        <a
          href={scriptPath(projectId, script.path)}
          target="_blank"
          rel="noopener"
          aria-label={`Open ${script.path} in a new tab`}
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
      <span className="block truncate px-2 pt-1 text-sm font-medium text-muted-foreground">{data.name}</span>
    </div>
  );
}

const NODE_TYPES = { flow: FlowNode, script: ScriptNode, folder: FolderNode };

/** an arrow over more than one column: through dagre's bends around the boxes between, smoothed; its label at the middle bend */
function RoutedEdge({ sourceX, sourceY, targetX, targetY, data, label, markerEnd, style }: EdgeProps<Edge<{ points: { x: number; y: number }[] }>>) {
  const points = [{ x: sourceX, y: sourceY }, ...(data?.points ?? []), { x: targetX, y: targetY }];
  // through the middle of each segment, each bend as the control point
  let path = `M ${points[0]!.x} ${points[0]!.y}`;
  for (let i = 1; i < points.length - 1; i++) {
    const next = points[i + 1]!;
    const end = i === points.length - 2 ? next : { x: (points[i]!.x + next.x) / 2, y: (points[i]!.y + next.y) / 2 };
    path += ` Q ${points[i]!.x} ${points[i]!.y} ${end.x} ${end.y}`;
  }
  if (points.length === 2) {
    path += ` L ${targetX} ${targetY}`;
  }
  const middle = points[Math.floor(points.length / 2)]!;
  return <BaseEdge path={path} label={label} labelX={middle.x} labelY={middle.y} labelBgPadding={[2, 4]} labelBgBorderRadius={2} markerEnd={markerEnd} style={style} />;
}

const EDGE_TYPES = { routed: RoutedEdge };
