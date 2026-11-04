import type { Connection, Edge } from '@xyflow/react';
import { CARD_WIDTH, portTop } from './node-geometry';
import { connectionProblem, inputPorts, outputPorts } from '@dataflow/core';

/*
 * Snap-to-connect: when a component is dropped with an input fitted on another one's output (the output's bump in the
 * input's hole: the cards side by side, one grid width apart, the two ports at the same height), they are connected,
 * even when the output already has edges (an output takes several), as long as the core's connection rules allow it
 * (connectionProblem: Lookup's inputs take one edge, never Start straight to End, never the same two ports twice).
 * Works both ways: the moved card's inputs and its outputs.
 */

type Placed = { id: string; position: { x: number; y: number }; data: { type: string; config: Record<string, unknown> } };

/** how far (px) a fit may be off: less than half a grid step */
const TOLERANCE = 6;

const near = (a: number, b: number) => Math.abs(a - b) <= TOLERANCE;

/** the connections `moved` makes by fitting its ports on the other cards' ports */
export function fittedConnections(moved: Placed, nodes: Placed[], edges: Edge[]): Connection[] {
  const typeOf = (id: string) => nodes.find(n => n.id === id)?.data.type ?? (moved.id === id ? moved.data.type : undefined);
  const added: Connection[] = [];
  const asPorts = (list: (Edge | Connection)[]) =>
    list.map(e => ({ source: e.source, sourcePort: e.sourceHandle ?? '', target: e.target, targetPort: e.targetHandle ?? '' }));

  const fit = (from: Placed, to: Placed) => {
    if (from.id === to.id || !near(to.position.x - from.position.x, CARD_WIDTH)) {
      return;
    }

    const outputs = outputPorts(from.data.type, from.data.config);
    inputPorts(to.data.type, to.data.config).forEach((input, i) => {
      const output = outputs.find((_, j) => near(from.position.y + portTop(j), to.position.y + portTop(i)));
      if (!output) {
        return;
      }

      const connection = { source: from.id, sourceHandle: output.id, target: to.id, targetHandle: input.id };
      const [edge] = asPorts([connection]);
      if (!connectionProblem(edge!, asPorts([...edges, ...added]), typeOf)) {
        added.push(connection);
      }
    });
  };

  for (const other of nodes) {
    fit(other, moved);
    fit(moved, other);
  }

  return added;
}
