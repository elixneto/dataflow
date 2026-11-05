import { addEdge, type Edge } from '@xyflow/react';
import { connectionProblem, ERROR_PORT } from '@dataflow/core';

/*
 * Deleting a component keeps the flow going through it: C1 → C2 → C3, delete C2, and C1 → C3 is connected. Only when
 * that is unambiguous: the deleted component had one edge in and one edge out (its error port's edges don't count:
 * errors don't continue on the normal path). Several deleted in a row (C2 and C3 of C1 → C2 → C3 → C4) give C1 → C4.
 * The new edge follows the core's rules (connectionProblem): a port that takes one edge and has one, Start straight to
 * End, the same two ports twice: no edge then. Undo brings back the deleted components and their edges, and takes the
 * new one away (the canvas is saved before the delete).
 */

type Ports = { source: string; sourceHandle: string; target: string; targetHandle: string };

const ports = (e: Edge | Ports): Ports => ({ source: e.source, sourceHandle: e.sourceHandle ?? '', target: e.target, targetHandle: e.targetHandle ?? '' });
const asCore = (e: Ports) => ({ source: e.source, sourcePort: e.sourceHandle, target: e.target, targetPort: e.targetHandle });

/** the edges that connect around the `deleted` components, valid among the edges that stay (`kept`) */
export function bridges(deleted: Set<string>, edges: Edge[], kept: Edge[], typeOf: (id: string) => string | undefined): Ports[] {
  let around = edges.filter(e => deleted.has(e.source) || deleted.has(e.target)).map(ports);
  for (const id of deleted) {
    const into = around.filter(e => e.target === id && e.source !== id);
    const out = around.filter(e => e.source === id && e.target !== id && e.sourceHandle !== ERROR_PORT);
    around = around.filter(e => e.source !== id && e.target !== id);
    if (into.length === 1 && out.length === 1) {
      around.push({ source: into[0]!.source, sourceHandle: into[0]!.sourceHandle, target: out[0]!.target, targetHandle: out[0]!.targetHandle });
    }
  }

  const accepted: Ports[] = [];
  for (const bridge of around) {
    const taken = [...kept.map(ports), ...accepted].map(asCore);
    if (!connectionProblem(asCore(bridge), taken, typeOf)) {
      accepted.push(bridge);
    }
  }

  return accepted;
}

/** the edges once the `deleted` components are gone: theirs removed, the ones around them added */
export function edgesAfterDelete(deleted: Set<string>, edges: Edge[], typeOf: (id: string) => string | undefined): Edge[] {
  const kept = edges.filter(e => !deleted.has(e.source) && !deleted.has(e.target));
  return bridges(deleted, edges, kept, typeOf).reduce<Edge[]>((next, bridge) => addEdge(bridge, next), kept);
}
