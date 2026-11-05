import { Graph, layout } from '@dagrejs/dagre';
import type { FlowCall } from '@dataflow/core';
import type { FlowCalls } from '@/data/flows/flows-api';

/*
 * The calls between a project's flows as a graph to draw: one box per flow that calls or is called, an arrow per
 * caller and called flow (the Flow Invokers that make it as its label), the flows of a folder inside a box of their
 * folder, left to right (callers on the left). Laid out by dagre; drawn by graph-view.tsx.
 */

export const NODE_WIDTH = 220;
export const NODE_HEIGHT = 56;

export type GraphFlow = { id: string; name: string; folder: string; available: boolean; known: boolean; x: number; y: number };
export type GraphCall = { id: string; from: string; to: string; label: string; onError: boolean; circular: boolean };
export type GraphFolder = { name: string; x: number; y: number; width: number; height: number };

/** the arrows: one per caller and called flow, its Flow Invokers as the label; `circular` when it closes a chain back */
export function graphCalls(data: Pick<FlowCalls, 'calls' | 'cycles'>): GraphCall[] {
  const inCycle = new Set(data.cycles.flatMap(ring => ring.slice(1).map((to, i) => `${ring[i]}>${to}`)));
  const byPair = new Map<string, FlowCall[]>();
  for (const c of data.calls) {
    const key = `${c.from}>${c.to}`;
    byPair.set(key, [...(byPair.get(key) ?? []), c]);
  }
  return [...byPair.entries()].map(([key, calls]) => ({
    id: key,
    from: calls[0]!.from,
    to: calls[0]!.to,
    label: calls.map(c => (c.onErrorOfLabel ? `${c.nodeLabel} (on error of ${c.onErrorOfLabel})` : c.nodeLabel)).join(', '),
    onError: calls.every(c => c.onErrorOf !== undefined),
    circular: inCycle.has(key),
  }));
}

/** the flows in the calls, the arrows and the folder boxes, with their places */
export function callsGraph(data: FlowCalls): { flows: GraphFlow[]; calls: GraphCall[]; folders: GraphFolder[] } {
  const calls = graphCalls(data);
  const byId = new Map(data.flows.map(f => [f.id, f]));
  const ids = [...new Set(calls.flatMap(c => [c.from, c.to]))];
  const graph = new Graph({ compound: true });
  graph.setGraph({ rankdir: 'LR', nodesep: 24, ranksep: 90, marginx: 10, marginy: 10 });
  graph.setDefaultEdgeLabel(() => ({}));
  const folderKey = (folder: string) => `folder:${folder}`;
  for (const id of ids) {
    graph.setNode(id, { width: NODE_WIDTH, height: NODE_HEIGHT });
    const folder = byId.get(id)?.folder;
    if (folder) {
      if (!graph.hasNode(folderKey(folder))) {
        graph.setNode(folderKey(folder), { label: folder, paddingTop: 28 });
      }
      graph.setParent(id, folderKey(folder));
    }
  }
  for (const c of calls) {
    graph.setEdge(c.from, c.to);
  }
  layout(graph);

  const flows = ids.map(id => {
    const flow = byId.get(id);
    const at = graph.node(id);
    return {
      id,
      name: flow?.name ?? 'Not found',
      folder: flow?.folder ?? '',
      available: flow?.available ?? false,
      known: !!flow,
      x: at.x - NODE_WIDTH / 2,
      y: at.y - NODE_HEIGHT / 2,
    };
  });
  const folders = [...new Set(ids.map(id => byId.get(id)?.folder).filter((f): f is string => !!f))].map(name => {
    const at = graph.node(folderKey(name));
    // room above the flows for the folder's name
    return { name, x: at.x - at.width / 2, y: at.y - at.height / 2 - 24, width: at.width, height: at.height + 24 };
  });
  return { flows, calls, folders };
}

/** every flow reached from `id` following the calls one way: what it calls (`uses`) or what calls it (`usedBy`), down the chain */
export function reached(calls: Pick<GraphCall, 'from' | 'to'>[], id: string, way: 'uses' | 'usedBy'): Set<string> {
  const [from, to] = way === 'uses' ? (['from', 'to'] as const) : (['to', 'from'] as const);
  const found = new Set<string>();
  const queue = [id];
  while (queue.length) {
    const current = queue.shift()!;
    for (const c of calls) {
      if (c[from] === current && !found.has(c[to]) && c[to] !== id) {
        found.add(c[to]);
        queue.push(c[to]);
      }
    }
  }
  return found;
}
