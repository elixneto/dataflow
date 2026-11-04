import type { Connection, Edge } from '@xyflow/react';
import { CARD_WIDTH, portTop } from './node-geometry';
import { inputPorts, outputPorts } from './ports';

/*
 * Snap-to-connect: when a component is dropped with an input fitted on another one's output (the output's bump in the
 * input's hole: the cards side by side, one grid width apart, the two ports at the same height), they are connected,
 * as long as neither port has an edge yet. Works both ways: the moved card's inputs and its outputs.
 */

type Placed = { id: string; position: { x: number; y: number }; data: { type: string; config: Record<string, unknown> } };

/** how far (px) a fit may be off: less than half a grid step */
const TOLERANCE = 6;

const near = (a: number, b: number) => Math.abs(a - b) <= TOLERANCE;

/** the connections `moved` makes by fitting its ports on the other cards' free ports */
export function fittedConnections(moved: Placed, nodes: Placed[], edges: Edge[]): Connection[] {
  const taken = (edge: Pick<Edge, 'source' | 'sourceHandle'> | Pick<Edge, 'target' | 'targetHandle'>) =>
    'source' in edge
      ? edges.some(e => e.source === edge.source && e.sourceHandle === edge.sourceHandle)
      : edges.some(e => e.target === edge.target && e.targetHandle === edge.targetHandle);

  const connections: Connection[] = [];
  const fit = (from: Placed, to: Placed) => {
    if (from.id === to.id || !near(to.position.x - from.position.x, CARD_WIDTH)) {
      return;
    }

    const outputs = outputPorts(from.data.type, from.data.config);
    inputPorts(to.data.type, to.data.config).forEach((input, i) => {
      const o = outputs.findIndex((_, j) => near(from.position.y + portTop(j), to.position.y + portTop(i)));
      const output = outputs[o];
      const connection = { source: from.id, sourceHandle: output?.id ?? null, target: to.id, targetHandle: input.id };
      if (output && !taken({ source: from.id, sourceHandle: output.id }) && !taken({ target: to.id, targetHandle: input.id })) {
        connections.push(connection);
      }
    });
  };

  for (const other of nodes) {
    fit(other, moved);
    fit(moved, other);
  }

  return connections;
}
