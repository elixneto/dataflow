import { describe, expect, test } from 'bun:test';
import type { Edge } from '@xyflow/react';
import { END, ERROR_PORT, START } from '@dataflow/core';
import { edgesAfterDelete } from '../src/editor/bridge-delete';
import { UndoStack } from '../src/editor/history';

const types: Record<string, string> = { start: START, end: END, c1: 'mapper', c2: 'sort', c3: 'mapper', c4: 'sort', c5: 'mapper', lookup: 'lookup' };
const typeOf = (id: string) => types[id];
const edge = (source: string, target: string, sourceHandle = 'out-0', targetHandle = 'in-0'): Edge => ({
  id: `${source}.${sourceHandle}>${target}.${targetHandle}`,
  source,
  sourceHandle,
  target,
  targetHandle,
});
/** the edges as source.port>target.port, sorted: what the canvas shows, whatever their ids */
const shape = (edges: Edge[]) => edges.map(e => `${e.source}.${e.sourceHandle}>${e.target}.${e.targetHandle}`).sort();
/** no edge twice, none from or to a component that is not there */
function sound(edges: Edge[], nodes: string[]) {
  const all = shape(edges);
  expect(new Set(all).size).toBe(all.length);
  for (const e of edges) {
    expect(nodes).toContain(e.source);
    expect(nodes).toContain(e.target);
  }
}

const chain = [edge('start', 'c1'), edge('c1', 'c2'), edge('c2', 'c3'), edge('c3', 'end')];

describe('deleting a component connects around it', () => {
  test('C1 → C2 → C3: without C2, C1 → C3 (same ports)', () => {
    const after = edgesAfterDelete(new Set(['c2']), chain, typeOf);
    expect(shape(after)).toEqual(['c1.out-0>c3.in-0', 'c3.out-0>end.in-0', 'start.out-0>c1.in-0']);
    sound(after, ['start', 'c1', 'c3', 'end']);
  });

  test('several in a row: C1 → C2 → C3 → C4 without C2 and C3 gives C1 → C4', () => {
    const edges = [edge('c1', 'c2'), edge('c2', 'c3'), edge('c3', 'c4')];
    expect(shape(edgesAfterDelete(new Set(['c3', 'c2']), edges, typeOf))).toEqual(['c1.out-0>c4.in-0']);
  });

  test('the only component between Start and End: no Start → End (the core does not allow it)', () => {
    expect(edgesAfterDelete(new Set(['c1']), [edge('start', 'c1'), edge('c1', 'end')], typeOf)).toEqual([]);
  });

  test("an error port's edge does not continue the normal path; one coming into the deleted component does", () => {
    const divert = [edge('c1', 'c2'), edge('c2', 'c3'), edge('c2', 'c4', ERROR_PORT)];
    expect(shape(edgesAfterDelete(new Set(['c2']), divert, typeOf))).toEqual(['c1.out-0>c3.in-0']);
    const fromError = [edge('c1', 'c2', ERROR_PORT), edge('c2', 'c3')];
    expect(shape(edgesAfterDelete(new Set(['c2']), fromError, typeOf))).toEqual([`c1.${ERROR_PORT}>c3.in-0`]);
  });

  test('ambiguous (two in or two out): only its edges go', () => {
    const twoIn = [edge('c1', 'c2'), edge('c3', 'c2', 'out-0', 'in-1'), edge('c2', 'c4')];
    expect(edgesAfterDelete(new Set(['c2']), twoIn, typeOf)).toEqual([]);
    const twoOut = [edge('c1', 'c2'), edge('c2', 'c3'), edge('c2', 'c4', 'out-1')];
    expect(edgesAfterDelete(new Set(['c2']), twoOut, typeOf)).toEqual([]);
  });

  test('never a second edge on a port that takes one (a Lookup input), never the same edge twice', () => {
    // the Lookup's input already has an edge (from C4): C1 → Lookup would be a second one
    const taken = [edge('c1', 'c2'), edge('c2', 'lookup'), edge('c4', 'lookup')];
    expect(shape(edgesAfterDelete(new Set(['c2']), taken, typeOf))).toEqual(['c4.out-0>lookup.in-0']);
    // C1 → C2 → C3 with C1 → C3 there already: still one C1 → C3
    const twice = [edge('c1', 'c2'), edge('c2', 'c3'), edge('c1', 'c3')];
    const result = edgesAfterDelete(new Set(['c2']), twice, typeOf);
    expect(shape(result)).toEqual(['c1.out-0>c3.in-0']);
    sound(result, ['c1', 'c3']);
  });

  test('Ctrl+Z brings back the component and its two edges and takes the new one away; Ctrl+Y does the delete again; nothing left over or twice', () => {
    type State = { nodes: string[]; edges: Edge[] };
    const stack = new UndoStack<State>();
    let state: State = { nodes: ['start', 'c1', 'c2', 'c3', 'end'], edges: chain };
    const deleteNode = (id: string) => {
      stack.record(state);
      state = { nodes: state.nodes.filter(n => n !== id), edges: edgesAfterDelete(new Set([id]), state.edges, typeOf) };
    };

    deleteNode('c2');
    const deleted = state;
    sound(state.edges, state.nodes);
    deleteNode('c3');
    expect(shape(state.edges)).toEqual(['c1.out-0>end.in-0', 'start.out-0>c1.in-0']);
    sound(state.edges, state.nodes);

    state = stack.undo(state)!;
    expect(shape(state.edges)).toEqual(shape(deleted.edges));
    state = stack.undo(state)!;
    expect(state.nodes).toEqual(['start', 'c1', 'c2', 'c3', 'end']);
    expect(shape(state.edges)).toEqual(shape(chain));
    sound(state.edges, state.nodes);

    state = stack.redo(state)!;
    expect(shape(state.edges)).toEqual(shape(deleted.edges));
    state = stack.redo(state)!;
    expect(shape(state.edges)).toEqual(['c1.out-0>end.in-0', 'start.out-0>c1.in-0']);
    // and back to the start once more: the same flow, not a copy with extra edges
    state = stack.undo(stack.undo(state)!)!;
    expect(shape(state.edges)).toEqual(shape(chain));
    sound(state.edges, state.nodes);
  });
});
