import { describe, expect, test } from 'bun:test';
import type { Edge } from '@xyflow/react';
import { fittedConnections } from '../src/editor/auto-connect';
import { CARD_WIDTH, PORT_GAP } from '../src/editor/node-geometry';

const card = (id: string, type: string, x: number, y: number, config: Record<string, unknown> = {}) => ({
  id,
  position: { x, y },
  data: { type, config },
});

describe('snap-to-connect', () => {
  const a = card('a', 'mapper', 0, 0);

  test('a card dropped right after another, ports at the same height, connects output → input', () => {
    const b = card('b', 'sort', CARD_WIDTH, 0);
    expect(fittedConnections(b, [a, b], [])).toEqual([{ source: 'a', sourceHandle: 'out-0', target: 'b', targetHandle: 'in-0' }]);
    // moving the first one next to the second works too
    expect(fittedConnections(a, [a, b], [])).toEqual([{ source: 'a', sourceHandle: 'out-0', target: 'b', targetHandle: 'in-0' }]);
  });

  test('not when apart, or at another height', () => {
    expect(fittedConnections(card('b', 'sort', CARD_WIDTH + 16, 0), [a], [])).toEqual([]);
    expect(fittedConnections(card('b', 'sort', CARD_WIDTH, 16), [a], [])).toEqual([]);
  });

  test('not when either port already has an edge', () => {
    const b = card('b', 'sort', CARD_WIDTH, 0);
    const fromA: Edge = { id: 'e1', source: 'a', sourceHandle: 'out-0', target: 'x', targetHandle: 'in-0' };
    const toB: Edge = { id: 'e2', source: 'x', sourceHandle: 'out-0', target: 'b', targetHandle: 'in-0' };
    expect(fittedConnections(b, [a, b], [fromA])).toEqual([]);
    expect(fittedConnections(b, [a, b], [toB])).toEqual([]);
  });

  test("a card's lower ports fit too: Copy's second output on a card a row below", () => {
    const copy = card('c', 'copy', 0, 0);
    const below = card('d', 'sort', CARD_WIDTH, PORT_GAP);
    expect(fittedConnections(below, [copy, below], [])).toEqual([{ source: 'c', sourceHandle: 'out-1', target: 'd', targetHandle: 'in-0' }]);
  });
});
