import type {Edge} from '@xyflow/react';
import type {FlowNode} from '#data/flows';

/*
 * Copying components through the system clipboard (the browser's copy / cut / paste events): a JSON text with a
 * marker, so pasting works into another flow, another tab or another window, and any other text is left alone.
 * Pure functions: the editor decides when (nothing selected, text selected, a field focused: the browser copies).
 */

const MARKER = 'components';
const VERSION = 1;

export type ComponentsPayload = {dataflow: typeof MARKER; version: typeof VERSION; flowId: string; nodes: FlowNode[]; edges: Edge[]};

/** The payload of the chosen nodes and the edges between them, without screen state (selection, measures). */
export function serializeComponents(flowId: string, chosen: FlowNode[], edges: Edge[]): string {
  const ids = new Set(chosen.map(n => n.id));
  const payload: ComponentsPayload = {
    dataflow: MARKER, version: VERSION, flowId,
    nodes: chosen.map(({selected: _selected, dragging: _dragging, ...node}) => node as FlowNode),
    edges: edges.filter(e => ids.has(e.source) && ids.has(e.target)).map(({selected: _selected, ...edge}) => edge),
  };
  return JSON.stringify(payload);
}

/** The payload, if the text is one; anything else (any copied text) is null. */
export function parseComponents(text: string): ComponentsPayload | null {
  if (!text.trimStart().startsWith('{')) return null;
  try {
    const value = JSON.parse(text) as Partial<ComponentsPayload>;
    if (value.dataflow !== MARKER || value.version !== VERSION || !Array.isArray(value.nodes) || !Array.isArray(value.edges)) return null;
    if (!value.nodes.every(n => n && typeof n.id === 'string' && n.position)) return null;
    return value as ComponentsPayload;
  } catch {
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
