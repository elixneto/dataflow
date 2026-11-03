import type {Edge} from '@xyflow/react';

/** Every how many pixels the edge's path is sampled when looking for the card over it. */
const STEP = 8;

export type Box = {x: number; y: number; w: number; h: number};

type Geometry = {d: string; box: Box; points?: {x: number; y: number}[]};

/**
 * Each drawn path's bounds and sampled points, kept while its `d` stays the same: a drag over the canvas asks for every
 * edge on each dragover (many per second), and sampling them all each time froze big flows for seconds. The points are
 * only sampled for an edge whose bounds reach the box.
 */
const sampled = new WeakMap<SVGPathElement, Geometry>();

function geometry(path: SVGPathElement): Geometry {
  const d = path.getAttribute('d') ?? '';
  const cached = sampled.get(path);
  if (cached && cached.d === d) return cached;
  const {x, y, width, height} = path.getBBox();
  const result: Geometry = {d, box: {x, y, w: width, h: height}};
  sampled.set(path, result);
  return result;
}

function points(path: SVGPathElement, geo: Geometry): {x: number; y: number}[] {
  if (geo.points) return geo.points;
  const length = path.getTotalLength();
  const list: {x: number; y: number}[] = [];
  for (let at = 0; at <= length; at += STEP) {
    const p = path.getPointAtLength(at);
    list.push({x: p.x, y: p.y});
  }
  geo.points = list;
  return list;
}

function overlaps(a: Box, b: Box): boolean {
  return a.x <= b.x + b.w && b.x <= a.x + a.w && a.y <= b.y + b.h && b.y <= a.y + a.h;
}

/**
 * Edge whose drawn path crosses the box (flow coordinates), ignoring the edges of `nodeId` itself. Reads the SVG path
 * React Flow drew, so it follows the real curve.
 */
export function edgeUnder(box: Box, edges: Edge[], nodeId?: string): Edge | undefined {
  return edges.find(e => {
    if (e.source === nodeId || e.target === nodeId) return false;
    const path = document.querySelector<SVGPathElement>(`.react-flow__edge[data-id="${CSS.escape(e.id)}"] .react-flow__edge-path`);
    if (!path) return false;
    const geo = geometry(path);
    if (!overlaps(geo.box, box)) return false;
    return points(path, geo).some(p => p.x >= box.x && p.x <= box.x + box.w && p.y >= box.y && p.y <= box.y + box.h);
  });
}

/** A→B becomes A→node (its first input) and node→B (its main output). */
export function splice(edges: Edge[], edge: Edge, nodeId: string): Edge[] {
  return [
    ...edges.filter(e => e.id !== edge.id),
    {id: `${edge.id}-in-${nodeId}`, source: edge.source, sourceHandle: edge.sourceHandle, target: nodeId, targetHandle: 'in-0'},
    {id: `${edge.id}-out-${nodeId}`, source: nodeId, sourceHandle: 'out-0', target: edge.target, targetHandle: edge.targetHandle},
  ];
}
