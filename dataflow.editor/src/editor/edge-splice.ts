import type { Edge } from '@xyflow/react';
import { connectionProblem, inputPorts, outputPorts } from '@dataflow/core';
import { isFixedType } from './catalog';

/*
 * Drop on an edge: a NEW component dropped from the palette with the pointer on an edge A→B goes into it: A→component
 * (its first input) and component→B (its first output). Not a component already on the canvas being moved (moving one
 * over an edge changes nothing). Only one with an input and an output; not Start or End. While dragging from the
 * palette, the edge it would go into is highlighted.
 */

/** around the pointer: an edge within this reach (canvas px) counts as under it */
export const SPLICE_REACH = 16;

/** every how many px the edge's drawn path is sampled when looking for the pointer on it */
const STEP = 8;

export type Box = { x: number; y: number; w: number; h: number };

type Geometry = { d: string; box: Box; points?: { x: number; y: number }[] };

/**
 * Each drawn path's bounds and sampled points, kept while its `d` stays the same: a drag asks for every edge many times
 * per second, and sampling them all each time froze big flows (seen in the PoC).
 */
const sampled = new WeakMap<SVGPathElement, Geometry>();

function geometry(path: SVGPathElement): Geometry {
  const d = path.getAttribute('d') ?? '';
  const cached = sampled.get(path);
  if (cached && cached.d === d) {
    return cached;
  }

  const { x, y, width, height } = path.getBBox();
  const result: Geometry = { d, box: { x, y, w: width, h: height } };
  sampled.set(path, result);
  return result;
}

function points(path: SVGPathElement, geo: Geometry) {
  if (!geo.points) {
    const length = path.getTotalLength();
    geo.points = [];
    for (let at = 0; at <= length; at += STEP) {
      const p = path.getPointAtLength(at);
      geo.points.push({ x: p.x, y: p.y });
    }
  }

  return geo.points;
}

const overlaps = (a: Box, b: Box) => a.x <= b.x + b.w && b.x <= a.x + a.w && a.y <= b.y + b.h && b.y <= a.y + a.h;

/** the box around the pointer (canvas coordinates) */
export const pointerBox = (p: { x: number; y: number }): Box => ({ x: p.x - SPLICE_REACH, y: p.y - SPLICE_REACH, w: SPLICE_REACH * 2, h: SPLICE_REACH * 2 });

/** the edge whose drawn path crosses the box, leaving out `nodeId`'s own edges (reads the SVG React Flow drew) */
export function edgeUnder(box: Box, edges: Edge[], nodeId?: string): Edge | undefined {
  return edges.find(e => {
    if (e.source === nodeId || e.target === nodeId) {
      return false;
    }

    const path = document.querySelector<SVGPathElement>(`.react-flow__edge[data-id="${CSS.escape(e.id)}"] .react-flow__edge-path`);
    if (!path) {
      return false;
    }

    const geo = geometry(path);
    return overlaps(geo.box, box) && points(path, geo).some(p => p.x >= box.x && p.x <= box.x + box.w && p.y >= box.y && p.y <= box.y + box.h);
  });
}

/** whether a new component of this type may go into an edge: with an input and an output, not Start/End, no edge yet */
export function canSplice(node: { id: string; data: { type: string; config: Record<string, unknown> } }, edges: Edge[]) {
  return (
    !isFixedType(node.data.type) &&
    inputPorts(node.data.type, node.data.config).length > 0 &&
    outputPorts(node.data.type, node.data.config).length > 0 &&
    !edges.some(e => e.source === node.id || e.target === node.id)
  );
}

/**
 * A→B becomes A→node (its first input) and node→B (its first output). Undefined when the core's rules refuse one of
 * the two new edges (then the edge stays as it was).
 */
export function splice(edges: Edge[], edge: Edge, nodeId: string, typeOf: (id: string) => string | undefined): Edge[] | undefined {
  const rest = edges.filter(e => e.id !== edge.id);
  const into: Edge = { id: `${edge.id}-in-${nodeId}`, source: edge.source, sourceHandle: edge.sourceHandle, target: nodeId, targetHandle: 'in-0' };
  const out: Edge = { id: `${edge.id}-out-${nodeId}`, source: nodeId, sourceHandle: 'out-0', target: edge.target, targetHandle: edge.targetHandle };
  const asPorts = (e: Edge) => ({ source: e.source, sourcePort: e.sourceHandle ?? '', target: e.target, targetPort: e.targetHandle ?? '' });
  if (connectionProblem(asPorts(into), rest.map(asPorts), typeOf) || connectionProblem(asPorts(out), [...rest, into].map(asPorts), typeOf)) {
    return undefined;
  }

  return [...rest, into, out];
}
