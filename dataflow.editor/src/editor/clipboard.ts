import type { Edge, Node } from '@xyflow/react';
import { FLOW_FILE_VERSION, type FlowFileNode } from '@dataflow/core';
import { componentInfo, isFixedType } from './catalog';
import type { ComponentNode } from './component-node';
import { canvasToFlowFile, flowFileToCanvas } from './flow-file';
import { CARD_HEIGHT, CARD_WIDTH } from './node-geometry';

/*
 * Copy and paste of components on the canvas (Ctrl+C / Ctrl+V), through the system clipboard: the selected components
 * and the edges between them, as the core's flow file nodes and edges with a marker, so a paste in another flow or tab
 * knows them. Their settings go as they are; a pin (run data) does not. The Start and the End are not copied: a flow
 * has one of each.
 */

/** what tells a paste that the clipboard holds components (and not text) */
export const CLIPBOARD_MARKER = 'dataflow/components';

type Copied = { marker: typeof CLIPBOARD_MARKER; version: typeof FLOW_FILE_VERSION; nodes: FlowFileNode[]; edges: { source: string; sourcePort: string; target: string; targetPort: string }[] };

/** where a node is on the canvas (a node in a group has its position inside the group) */
const absolute = (node: Node, all: Node[]) => {
  const parent = node.parentId ? all.find(n => n.id === node.parentId) : undefined;
  return parent ? { x: parent.position.x + node.position.x, y: parent.position.y + node.position.y } : node.position;
};

/** The selected components (not the Start nor the End) and the edges between them, as clipboard text; null: none. */
export function copiedComponents(nodes: Node[], edges: Edge[]): string | null {
  const selected = nodes.filter(n => n.type === 'component' && n.selected && !isFixedType((n.data as { type: string }).type));
  if (selected.length === 0) {
    return null;
  }

  const ids = new Set(selected.map(n => n.id));
  const placed = selected.map(n => ({ ...n, position: absolute(n, nodes), parentId: undefined }));
  const file = canvasToFlowFile({ name: 'copy' }, placed, edges.filter(e => ids.has(e.source) && ids.has(e.target)));
  const copied: Copied = {
    marker: CLIPBOARD_MARKER,
    version: FLOW_FILE_VERSION,
    // no pin: it is run data, not the component
    nodes: file.nodes.map(({ pinned: _pinned, ...n }) => n),
    edges: file.edges,
  };
  return JSON.stringify(copied);
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** a name not used yet on the canvas: the same, or with 2, 3... after it */
function freeLabel(label: string, used: Set<string>): string {
  if (!used.has(label)) {
    return label;
  }

  let n = 2;
  while (used.has(`${label} ${n}`)) {
    n++;
  }

  return `${label} ${n}`;
}

/**
 * The components of clipboard text, ready to add: new ids, placed as a whole (their layout kept) with their top left
 * corner at `at` (where the pointer is on this canvas) or, with `center`, their middle there (the middle of what is on
 * screen), `offset` further when pasted again at the same place; a name of their own when theirs is taken. Null when
 * the text is not copied components (then the paste is the browser's).
 */
export function pastedComponents(
  text: string,
  existing: Node[],
  at: { x: number; y: number },
  options: { offset?: number; center?: boolean } = {},
): { nodes: ComponentNode[]; edges: Edge[] } | null {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return null;
  }

  if (!isObject(data) || data.marker !== CLIPBOARD_MARKER || !Array.isArray(data.nodes) || !Array.isArray(data.edges)) {
    return null;
  }

  // only components this editor knows, never a Start or an End
  const valid = (n: unknown): n is FlowFileNode =>
    isObject(n) &&
    typeof n.id === 'string' &&
    typeof n.type === 'string' &&
    !isFixedType(n.type) &&
    componentInfo(n.type) !== undefined &&
    isObject(n.position) &&
    typeof n.position.x === 'number' &&
    typeof n.position.y === 'number' &&
    (n.config === undefined || isObject(n.config));
  const nodes = data.nodes.filter(valid);
  if (nodes.length === 0) {
    return null;
  }

  const ids = new Map(nodes.map(n => [n.id, crypto.randomUUID()]));
  // the copy keeps its shape: it moves as a whole, its top left corner (or its middle) to `at`
  const left = Math.min(...nodes.map(n => n.position.x));
  const top = Math.min(...nodes.map(n => n.position.y));
  const width = Math.max(...nodes.map(n => n.position.x)) + CARD_WIDTH - left;
  const height = Math.max(...nodes.map(n => n.position.y)) + CARD_HEIGHT - top;
  const offset = options.offset ?? 0;
  const dx = at.x + offset - left - (options.center ? width / 2 : 0);
  const dy = at.y + offset - top - (options.center ? height / 2 : 0);
  const used = new Set(existing.flatMap(n => ((n.data as { label?: string }).label ? [(n.data as { label: string }).label] : [])));
  const renamed = nodes.map(n => {
    const label = n.label ? freeLabel(n.label, used) : undefined;
    if (label) {
      used.add(label);
    }

    return { ...n, id: ids.get(n.id)!, label, config: n.config ?? {}, position: { x: n.position.x + dx, y: n.position.y + dy } };
  });
  const edges = (data.edges as unknown[]).filter(
    (e): e is Copied['edges'][number] =>
      isObject(e) && ids.has(e.source as string) && ids.has(e.target as string) && typeof e.sourcePort === 'string' && typeof e.targetPort === 'string',
  );
  const canvas = flowFileToCanvas({
    version: FLOW_FILE_VERSION,
    name: 'paste',
    nodes: renamed,
    edges: edges.map(e => ({ ...e, source: ids.get(e.source)!, target: ids.get(e.target)! })),
  });
  return { nodes: (canvas.nodes as ComponentNode[]).map(n => ({ ...n, selected: true })), edges: canvas.edges };
}
