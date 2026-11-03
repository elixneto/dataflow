import type {Edge} from '@xyflow/react';
import {parse as parseYaml, stringify as stringifyYaml} from 'yaml';
import {cleanEdge, fullNode, leanNode, type FlowNode} from '#data/flows';

/*
 * Copying components through the system clipboard (the browser's copy / cut / paste events): a YAML text that starts
 * with a marker, so pasting works into another flow, another tab or another window, and any other text is left
 * alone. YAML in the same style and node shape as the flow's "Download YAML" (and the future import): scripts and SQL
 * come out as multi-line blocks. The JSON of the first version is still accepted. Pure functions: the editor decides
 * when (nothing selected, text selected, a field focused: the browser copies).
 */

const MARKER = 'components';
const VERSION = 1;

export type ComponentsPayload = {dataflow: typeof MARKER; version: typeof VERSION; flowId: string; nodes: FlowNode[]; edges: Edge[]};

/** The text of the chosen nodes and the edges between them, without screen state (selection, measures) nor defaults. */
export function serializeComponents(flowId: string, chosen: FlowNode[], edges: Edge[]): string {
  const ids = new Set(chosen.map(n => n.id));
  const payload = {
    dataflow: MARKER, version: VERSION, flowId,
    nodes: chosen.map(leanNode),
    edges: edges.filter(e => ids.has(e.source) && ids.has(e.target)).map(cleanEdge),
  };
  return stringifyYaml(payload, {blockQuote: 'literal', lineWidth: 0, indent: 2});
}

/** The payload, if the text is one (YAML that starts with the marker, or the JSON of the first version); else null. */
export function parseComponents(text: string): ComponentsPayload | null {
  const start = text.trimStart();
  if (!start.startsWith(`dataflow: ${MARKER}`) && !start.startsWith('{')) return null;
  try {
    const value = (start.startsWith('{') ? JSON.parse(start) : parseYaml(start)) as Record<string, unknown> | null;
    if (!value || value.dataflow !== MARKER || value.version !== VERSION || !Array.isArray(value.nodes)) return null;
    const nodes = (value.nodes as Record<string, unknown>[]).filter(n => n && typeof n.id === 'string' && n.position).map(fullNode);
    if (nodes.length !== value.nodes.length) return null;
    const edges = Array.isArray(value.edges) ? (value.edges as Edge[]).map(cleanEdge) : [];
    return {dataflow: MARKER, version: VERSION, flowId: typeof value.flowId === 'string' ? value.flowId : '', nodes, edges};
  } catch {
    // marked but broken: left to the browser
    return null;
  }
}

/** The pasted nodes and edges, with new ids, moved by `offset` and selected; edges to nodes not pasted are dropped. */
export function pastedComponents(payload: ComponentsPayload, offset: number, newId: (node: FlowNode) => string, newEdgeId: () => string) {
  const ids = new Map<string, string>();
  const nodes = payload.nodes.map(n => {
    const id = newId(n);
    ids.set(n.id, id);
    return {...structuredClone(n), id, selected: true, dragging: false, position: {x: n.position.x + offset, y: n.position.y + offset}} as FlowNode;
  });
  const edges = payload.edges
    .filter(e => ids.has(e.source) && ids.has(e.target))
    .map(e => ({...structuredClone(e), id: newEdgeId(), source: ids.get(e.source)!, target: ids.get(e.target)!, selected: false}));
  return {nodes, edges};
}
