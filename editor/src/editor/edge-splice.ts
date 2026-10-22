import type {Edge} from '@xyflow/react';

/** Every how many pixels the edge's path is sampled when looking for the card over it. */
const STEP = 8;

export type Box = {x: number; y: number; w: number; h: number};

/**
 * Edge whose drawn path crosses the box (flow coordinates), ignoring the edges of `nodeId` itself. Reads the SVG path
 * React Flow drew, so it follows the real curve.
 */
export function edgeUnder(box: Box, edges: Edge[], nodeId?: string): Edge | undefined {
  return edges.find(e => {
    if (e.source === nodeId || e.target === nodeId) return false;
    const path = document.querySelector<SVGPathElement>(`.react-flow__edge[data-id="${CSS.escape(e.id)}"] .react-flow__edge-path`);
    if (!path) return false;
    const length = path.getTotalLength();
    for (let d = 0; d <= length; d += STEP) {
      const p = path.getPointAtLength(d);
      if (p.x >= box.x && p.x <= box.x + box.w && p.y >= box.y && p.y <= box.y + box.h) return true;
    }
    return false;
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
