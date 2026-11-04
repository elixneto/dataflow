import { describe, expect, test } from 'bun:test';
import type { Edge } from '@xyflow/react';
import { canSplice, splice } from '../src/editor/edge-splice';

const types: Record<string, string> = { start: 'start', end: 'end', a: 'mapper', b: 'sort', n: 'filter', l: 'lookup' };
const typeOf = (id: string) => types[id];
const node = (id: string) => ({ id, data: { type: types[id]!, config: {} } });
const ab: Edge = { id: 'ab', source: 'a', sourceHandle: 'out-0', target: 'b', targetHandle: 'in-0' };

describe('drop on an edge', () => {
  test('A→B becomes A→component (first input) and component→B (first output)', () => {
    expect(splice([ab], ab, 'n', typeOf)).toEqual([
      { id: 'ab-in-n', source: 'a', sourceHandle: 'out-0', target: 'n', targetHandle: 'in-0' },
      { id: 'ab-out-n', source: 'n', sourceHandle: 'out-0', target: 'b', targetHandle: 'in-0' },
    ]);
  });

  test("only a loose component with an input and an output; not Start or End", () => {
    expect(canSplice(node('n'), [ab])).toBe(true);
    expect(canSplice(node('a'), [ab])).toBe(false);
    expect(canSplice(node('start'), [])).toBe(false);
    expect(canSplice(node('end'), [])).toBe(false);
  });

  test("the core's rules still hold: a Start→X edge does not take a component that would make Start→End", () => {
    const startToEnd: Edge = { id: 'se', source: 'start', sourceHandle: 'out-0', target: 'a', targetHandle: 'in-0' };
    expect(splice([startToEnd], startToEnd, 'n', typeOf)).toHaveLength(2);
    // a Lookup's second input already taken: going in through its first input is fine
    const toLookup: Edge = { id: 'al', source: 'a', sourceHandle: 'out-0', target: 'l', targetHandle: 'in-0' };
    expect(splice([toLookup], toLookup, 'n', typeOf)?.map(e => `${e.source}>${e.target}:${e.targetHandle}`)).toEqual(['a>n:in-0', 'n>l:in-0']);
  });
});
