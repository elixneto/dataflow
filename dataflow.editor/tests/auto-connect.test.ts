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

  test("ports that already have edges take one more when fitted, but not Lookup's inputs", () => {
    const b = card('b', 'sort', CARD_WIDTH, 0);
    const fromA: Edge = { id: 'e1', source: 'a', sourceHandle: 'out-0', target: 'x', targetHandle: 'in-0' };
    const toB: Edge = { id: 'e2', source: 'x', sourceHandle: 'out-0', target: 'b', targetHandle: 'in-0' };
    const aToB = [{ source: 'a', sourceHandle: 'out-0', target: 'b', targetHandle: 'in-0' }];
    expect(fittedConnections(b, [a, b], [fromA])).toEqual(aToB);
    expect(fittedConnections(b, [a, b], [toB])).toEqual(aToB);

    const lookup = card('l', 'lookup', CARD_WIDTH, 0);
    const toLookup: Edge = { id: 'e3', source: 'x', sourceHandle: 'out-0', target: 'l', targetHandle: 'in-0' };
    expect(fittedConnections(lookup, [a, lookup], [toLookup])).toEqual([]);
  });

  test('the Start and the End take several when fitted too; the same two ports are not connected twice', () => {
    const start = card('start', 'start', 0, 0);
    const b = card('b', 'sort', CARD_WIDTH, 0);
    const startToOther: Edge = { id: 'e', source: 'start', sourceHandle: 'out-0', target: 'x', targetHandle: 'in-0' };
    expect(fittedConnections(b, [start, b], [])).toEqual([{ source: 'start', sourceHandle: 'out-0', target: 'b', targetHandle: 'in-0' }]);
    expect(fittedConnections(b, [start, b], [startToOther])).toEqual([{ source: 'start', sourceHandle: 'out-0', target: 'b', targetHandle: 'in-0' }]);

    const end = card('end', 'end', CARD_WIDTH, 0);
    const otherToEnd: Edge = { id: 'f', source: 'x', sourceHandle: 'out-0', target: 'end', targetHandle: 'in-0' };
    expect(fittedConnections(end, [a, end], [otherToEnd])).toEqual([{ source: 'a', sourceHandle: 'out-0', target: 'end', targetHandle: 'in-0' }]);

    const already: Edge = { id: 'g', source: 'a', sourceHandle: 'out-0', target: 'end', targetHandle: 'in-0' };
    expect(fittedConnections(end, [a, end], [already])).toEqual([]);

    // the core's rule: never Start straight to End, even fitted
    expect(fittedConnections(end, [start, end], [])).toEqual([]);
  });

  test("a card's lower ports fit too: Filter's second output on a card a row below", () => {
    const copy = card('c', 'filter', 0, 0);
    const below = card('d', 'sort', CARD_WIDTH, PORT_GAP);
    expect(fittedConnections(below, [copy, below], [])).toEqual([{ source: 'c', sourceHandle: 'out-1', target: 'd', targetHandle: 'in-0' }]);
  });
});
