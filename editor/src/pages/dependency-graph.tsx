import {useMemo} from 'react';
import {Background, BackgroundVariant, Controls, MarkerType, Position, ReactFlow, type Edge, type Node} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import {Graph, layout} from '@dagrejs/dagre';
import {workflowCalls} from '@dataflow/core';
import {listFlows, type Flow} from '#mock/flows';
import {toExecutable} from '#run/runner';
import {cn} from '#lib/utils';

/** The flow and every flow reachable from it following the calls forward (uses) and backward (used by). */
function chainOf(id: string, calls: {from: string; to: string}[]): Set<string> {
  const chain = new Set([id]);
  for (const [from, to] of [['from', 'to'], ['to', 'from']] as const) {
    const queue = [id];
    while (queue.length) {
      const current = queue.shift()!;
      for (const c of calls) {
        if (c[from] === current && !chain.has(c[to])) {
          chain.add(c[to]);
          queue.push(c[to]);
        }
      }
    }
  }
  return chain;
}

const NODE_WIDTH = 220;
const NODE_HEIGHT = 56;

/**
 * Graph of the calls between flows (Workflow Invoker): an arrow from the flow that calls to the flow that is called.
 * Only flows with some call show up; the ones of other projects that are called come along. `focus` highlights a flow
 * and everything in its chain (what it calls, directly or not, and what calls it); the rest is dimmed.
 */
export function DependencyGraph({projectId, focus, onOpen}: {projectId: string; focus?: string; onOpen: (flow: Flow) => void}) {
  const {nodes, edges} = useMemo(() => {
    const all = listFlows();
    const byId = new Map(all.map(f => [f.id, f]));
    const calls = workflowCalls(all.map(f => toExecutable(f.name, f.parameters ?? [], f.nodes, f.edges, f.id, f.projectId)));
    // calls that touch the project (made or received by one of its flows)
    const mine = calls.filter(c => byId.get(c.from)?.projectId === projectId || byId.get(c.to)?.projectId === projectId);
    const ids = [...new Set(mine.flatMap(c => [c.from, c.to]))];
    const near = focus ? chainOf(focus, mine) : undefined;

    const graph = new Graph();
    graph.setGraph({rankdir: 'LR', nodesep: 40, ranksep: 120, marginx: 20, marginy: 20});
    graph.setDefaultEdgeLabel(() => ({}));
    for (const id of ids) graph.setNode(id, {width: NODE_WIDTH, height: NODE_HEIGHT});
    for (const c of mine) graph.setEdge(c.from, c.to);
    layout(graph);

    const flowNodes: Node[] = ids.map(id => {
      const flow = byId.get(id);
      const p = graph.node(id);
      return {
        id, position: {x: p.x - NODE_WIDTH / 2, y: p.y - NODE_HEIGHT / 2}, connectable: false,
        // left to right: arrives on the left, leaves on the right
        targetPosition: Position.Left, sourcePosition: Position.Right,
        data: {
          flow,
          label: (
            <div className="flex min-w-0 flex-col text-left">
              <span className={cn('truncate text-sm font-medium', !flow && 'text-destructive')}>{flow?.name ?? 'Not found'}</span>
              <span className="truncate text-sm text-muted-foreground">
                {flow ? (flow.projectId !== projectId ? 'Other project' : flow.folder || 'Flows (root)') : id}
              </span>
            </div>
          ),
        },
        style: {width: NODE_WIDTH},
        className: cn('dependency-node', id === focus && 'is-focus', near && !near.has(id) && 'opacity-30'),
      };
    });
    const flowEdges: Edge[] = mine.map(c => ({
      id: `${c.from}:${c.nodeId}`, source: c.from, target: c.to, label: c.nodeLabel,
      markerEnd: {type: MarkerType.ArrowClosed},
      className: cn(near && !(near.has(c.from) && near.has(c.to)) && 'opacity-30'),
    }));
    return {nodes: flowNodes, edges: flowEdges};
  }, [projectId, focus]);

  if (nodes.length === 0) {
    return <p className="rounded-lg border border-dashed border-border p-8 text-center text-sm text-muted-foreground">No dependencies</p>;
  }
  return (
    <div className="h-[65vh] overflow-hidden rounded-lg border border-border">
      <ReactFlow nodes={nodes} edges={edges} fitView fitViewOptions={{padding: 0.2, maxZoom: 1}} nodesDraggable={false} nodesConnectable={false}
                 edgesFocusable={false} proOptions={{hideAttribution: true}}
                 onNodeClick={(_, node) => {
                   const flow = (node.data as {flow?: Flow}).flow;
                   if (flow) onOpen(flow);
                 }}>
        <Background variant={BackgroundVariant.Lines} gap={20} color="var(--grid)" lineWidth={0.5}/>
        <Controls position="bottom-left" showInteractive={false}/>
      </ReactFlow>
    </div>
  );
}
