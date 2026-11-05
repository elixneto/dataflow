import { Graph, layout } from '@dagrejs/dagre';
import type { FlowCall } from '@dataflow/core';
import type { FlowCalls } from '@/data/flows/flows-api';

/*
 * A project's dependencies as a graph to draw: one box per flow that calls or is called, an arrow per caller and called
 * flow (the Flow Invokers that make it as its label), the flows of a folder inside a box of their folder; and, with the
 * scripts, one box per script a flow uses (a TypeScript component imports it, or a setting such as the Start's input
 * type names a type of it) or that imports or is imported by another script, an arrow from the flow to the script and
 * from a script to the one it imports. Left to right (what uses on the left). Laid out by dagre; drawn by graph-view.tsx.
 */

export const NODE_WIDTH = 220;
export const NODE_HEIGHT = 64;
export const SCRIPT_HEIGHT = 48;
/** the gap between columns: room for an arrow's label (at most LABEL_MAX characters) between the boxes */
const RANK_SEP = 150;
export const LABEL_MAX = 22;

/** an arrow's label as drawn: cut at LABEL_MAX characters with an ellipsis, so it stays in the gap and off the boxes */
export function shortLabel(label: string, max = LABEL_MAX): string {
  return label.length <= max ? label : `${label.slice(0, max - 1).trimEnd()}…`;
}

/** a script's box id: `script:<path>` (a flow's is its id) */
export const scriptNodeId = (path: string) => `script:${path}`;

export type GraphFlow = { id: string; name: string; folder: string; available: boolean; known: boolean; x: number; y: number };
export type GraphScript = { id: string; path: string; known: boolean; x: number; y: number };
/** an arrow: a flow calling a flow (`call`), a flow using a script (`uses`), a script importing a script (`imports`) */
export type GraphCall = {
  id: string;
  from: string;
  to: string;
  label: string;
  onError: boolean;
  circular: boolean;
  kind: 'call' | 'uses' | 'imports';
  /** an arrow over more than one column: the way around the boxes between (dagre's bends), not straight through them */
  points?: { x: number; y: number }[];
};
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
    kind: 'call' as const,
  }));
}

/** the arrows to scripts: one per flow and script it uses (its components as the label), one per script and script it imports */
export function scriptArrows(data: Pick<FlowCalls, 'scriptUses' | 'scriptImports'>): GraphCall[] {
  const byPair = new Map<string, FlowCalls['scriptUses']>();
  for (const u of data.scriptUses) {
    const key = `${u.from}>${scriptNodeId(u.path)}`;
    byPair.set(key, [...(byPair.get(key) ?? []), u]);
  }
  const uses = [...byPair.entries()].map(([key, list]) => ({
    id: key,
    from: list[0]!.from,
    to: scriptNodeId(list[0]!.path),
    label: list.map(u => (u.how === 'type' ? `${u.nodeLabel} (input type)` : u.nodeLabel)).join(', '),
    onError: false,
    circular: false,
    kind: 'uses' as const,
  }));
  const imports = [...new Map(data.scriptImports.map(i => [`${scriptNodeId(i.from)}>${scriptNodeId(i.to)}`, i])).entries()].map(([key, i]) => ({
    id: key,
    from: scriptNodeId(i.from),
    to: scriptNodeId(i.to),
    label: '',
    onError: false,
    circular: false,
    kind: 'imports' as const,
  }));
  return [...uses, ...imports];
}

/** the flows in the calls (and the scripts, with `scripts`), the arrows and the folder boxes, with their places */
export function callsGraph(
  data: FlowCalls,
  { scripts: withScripts = true }: { scripts?: boolean } = {},
): { flows: GraphFlow[]; scripts: GraphScript[]; calls: GraphCall[]; folders: GraphFolder[] } {
  const calls = [...graphCalls(data), ...(withScripts ? scriptArrows(data) : [])];
  const byId = new Map(data.flows.map(f => [f.id, f]));
  const isScript = (id: string) => id.startsWith('script:');
  const all = [...new Set(calls.flatMap(c => [c.from, c.to]))];
  const ids = all.filter(id => !isScript(id));
  const scriptIds = all.filter(isScript);
  const graph = new Graph({ compound: true });
  graph.setGraph({ rankdir: 'LR', nodesep: 24, ranksep: RANK_SEP, marginx: 10, marginy: 10 });
  graph.setDefaultEdgeLabel(() => ({}));
  const folderKey = (folder: string) => `folder:${folder}`;
  for (const id of scriptIds) {
    graph.setNode(id, { width: NODE_WIDTH, height: SCRIPT_HEIGHT });
  }
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
  // an arrow that skips a column goes the way dagre found around the boxes of the columns between
  const centerX = (id: string) => graph.node(id).x;
  const routed = calls.map(c => {
    const points = graph.edge(c.from, c.to)?.points;
    return points && centerX(c.to) - centerX(c.from) > (NODE_WIDTH + RANK_SEP) * 1.5 ? { ...c, points: points.slice(1, -1) } : c;
  });
  const known = new Set(data.scripts);
  const scripts = scriptIds.map(id => {
    const at = graph.node(id);
    const path = id.slice('script:'.length);
    return { id, path, known: known.has(path), x: at.x - NODE_WIDTH / 2, y: at.y - SCRIPT_HEIGHT / 2 };
  });
  const folders = [...new Set(ids.map(id => byId.get(id)?.folder).filter((f): f is string => !!f))].map(name => {
    const at = graph.node(folderKey(name));
    // room above the flows for the folder's name
    return { name, x: at.x - at.width / 2, y: at.y - at.height / 2 - 24, width: at.width, height: at.height + 24 };
  });
  return { flows, scripts, calls: routed, folders };
}

/** every flow or script reached from `id` following the arrows one way: what it uses (`uses`) or what uses it (`usedBy`), down the chain */
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
