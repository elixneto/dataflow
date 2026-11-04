import { describe, expect, test } from 'bun:test';
import type { Edge } from '@xyflow/react';
import { arrange } from '../src/editor/arrange';
import { fittedConnections } from '../src/editor/auto-connect';
import { CARD_WIDTH, PORT_GAP } from '../src/editor/node-geometry';

const card = (id: string, type: string, x: number, y: number, config: Record<string, unknown> = {}) => ({
  id,
  type: 'component',
  position: { x, y },
  data: { type, config },
});

const edge = (source: string, target: string, sourceHandle = 'out-0', targetHandle = 'in-0'): Edge => ({
  id: `${source}-${sourceHandle}-${target}-${targetHandle}`,
  source,
  sourceHandle,
  target,
  targetHandle,
});

const at = (nodes: { id: string; position: { x: number; y: number } }[]) =>
  Object.fromEntries(nodes.map(n => [n.id, [n.position.x, n.position.y]]));

describe('arrange (left to right, glued)', () => {
  test('a line of cards: one card width apart, same row, from the top left of where they were', () => {
    const nodes = [card('c', 'log', 900, 500), card('a', 'mapper', 100, 40), card('b', 'sort', 400, 300)];
    const placed = arrange(nodes, [edge('a', 'b'), edge('b', 'c')]);
    expect(at(placed)).toEqual({ a: [100, 40], b: [100 + CARD_WIDTH, 40], c: [100 + 2 * CARD_WIDTH, 40] });
  });

  test('glued cards fit: each output sits in the next input (what snap-to-connect sees)', () => {
    const placed = arrange([card('a', 'mapper', 0, 0), card('b', 'sort', 500, 500)], [edge('a', 'b')]);
    expect(fittedConnections(placed[1]!, placed, [])).toEqual([{ source: 'a', sourceHandle: 'out-0', target: 'b', targetHandle: 'in-0' }]);
  });

  test("a branch goes a row down, where the second output is (Filter's false)", () => {
    const placed = arrange([card('f', 'filter', 0, 0), card('t', 'log', 0, 0), card('x', 'sort', 0, 0)], [edge('f', 't'), edge('f', 'x', 'out-1')]);
    expect(at(placed)).toEqual({ f: [0, 0], t: [CARD_WIDTH, 0], x: [CARD_WIDTH, PORT_GAP] });
  });

  test("a Union lines up with its first input; the second source's card above it on another row", () => {
    const nodes = [card('a', 'mapper', 0, 0), card('b', 'sort', 0, 100), card('u', 'union', 0, 0)];
    const placed = arrange(nodes, [edge('a', 'u'), edge('b', 'u', 'out-0', 'in-1')]);
    expect(at(placed)).toEqual({ a: [0, 0], b: [0, PORT_GAP], u: [CARD_WIDTH, 0] });
  });

  test('a group is resized around the cards that were inside it, with room for its title', () => {
    const group = { id: 'g', type: 'group', position: { x: -100, y: -100 }, width: 900, height: 700, data: {} };
    const placed = arrange([group, card('a', 'mapper', 0, 0), card('b', 'sort', 400, 300)], [edge('a', 'b')]);
    // cards at (0, 0) and (160, 0); the box: 32 left, 48 above, 32 right of the second card, 32 below
    expect(placed[0]).toMatchObject({ position: { x: -32, y: -48 }, width: 2 * CARD_WIDTH + 64, height: 64 + 48 + 32 });
  });

  test('groups never overlap: a group fed by another one starts a column later; groups of separate flows go down', () => {
    const boxOf = (n: { position: { x: number; y: number }; width?: number; height?: number }) => ({ ...n.position, w: n.width!, h: n.height! });
    const apart = (a: ReturnType<typeof boxOf>, b: ReturnType<typeof boxOf>) =>
      a.x + a.w <= b.x || b.x + b.w <= a.x || a.y + a.h <= b.y || b.y + b.h <= a.y;
    const groupA = { id: 'ga', type: 'group', position: { x: -50, y: -50 }, width: 400, height: 200, data: {} };
    const groupB = { id: 'gb', type: 'group', position: { x: 450, y: -50 }, width: 400, height: 200, data: {} };

    // a → b inside group A, b → c → d inside group B
    const chained = arrange(
      [groupA, groupB, card('a', 'mapper', 0, 0), card('b', 'sort', 170, 0), card('c', 'log', 500, 0), card('d', 'limit', 670, 0)],
      [edge('a', 'b'), edge('b', 'c'), edge('c', 'd')],
    );
    expect(apart(boxOf(chained[0]!), boxOf(chained[1]!))).toBe(true);
    expect(at(chained)).toMatchObject({ a: [0, 0], b: [CARD_WIDTH, 0], c: [3 * CARD_WIDTH, 0], d: [4 * CARD_WIDTH, 0] });

    // two flows, each in its group, nothing between them
    const separate = arrange([groupA, groupB, card('a', 'mapper', 0, 0), card('c', 'log', 500, 0)], []);
    expect(apart(boxOf(separate[0]!), boxOf(separate[1]!))).toBe(true);
  });

  test('groups inside a group do not overlap either, and stay inside it', () => {
    type Sized = { id: string; position: { x: number; y: number }; width?: number; height?: number };
    const boxOf = (n: Sized) => ({ ...n.position, w: n.width!, h: n.height! });
    const apart = (a: ReturnType<typeof boxOf>, b: ReturnType<typeof boxOf>) =>
      a.x + a.w <= b.x || b.x + b.w <= a.x || a.y + a.h <= b.y || b.y + b.h <= a.y;
    const within = (a: ReturnType<typeof boxOf>, b: ReturnType<typeof boxOf>) => a.x >= b.x && a.y >= b.y && a.x + a.w <= b.x + b.w && a.y + a.h <= b.y + b.h;

    const green = { id: 'green', type: 'group', position: { x: -100, y: -100 }, width: 1000, height: 1000, data: {} };
    const blue = { id: 'blue', type: 'group', position: { x: -40, y: -40 }, width: 260, height: 120, data: {} };
    const yellow = { id: 'yellow', type: 'group', position: { x: -40, y: 100 }, width: 260, height: 120, data: {} };
    const placed = arrange(
      [green, blue, yellow, card('a', 'typescript', 0, 0), card('b', 'sqlserver', 0, 140), card('u', 'union', 400, 0)],
      [edge('a', 'u'), edge('b', 'u', 'out-0', 'in-1')],
    ) as Sized[];
    const box = (id: string) => boxOf(placed.find(n => n.id === id)!);

    expect(apart(box('blue'), box('yellow'))).toBe(true);
    expect(within(box('blue'), box('green'))).toBe(true);
    expect(within(box('yellow'), box('green'))).toBe(true);
  });

  test('separate flows one below the other; groups and loose cards are kept', () => {
    const group = { id: 'g', type: 'group', position: { x: 7, y: 7 }, data: {} };
    const placed = arrange([card('a', 'mapper', 0, 0), card('b', 'sort', 0, 50), group], []);
    expect(at(placed)).toEqual({ a: [0, 0], b: [0, PORT_GAP], g: [7, 7] });
  });
});
