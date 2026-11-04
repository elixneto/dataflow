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
    // Filter's outputs have names (true, false): the next column leaves room for them (64 px: 5 letters and the room)
    expect(at(placed)).toEqual({ f: [0, 0], t: [CARD_WIDTH + 64, 0], x: [CARD_WIDTH + 64, PORT_GAP] });
  });

  test('not glued after an output with several edges: room for its 2x, 3x; the other branches stacked above the main one', () => {
    const placed = arrange(
      [card('s', 'mapper', 0, 0), card('a', 'sort', 0, 0), card('b', 'log', 0, 0), card('c', 'limit', 0, 0)],
      [edge('s', 'a'), edge('s', 'b'), edge('s', 'c')],
    );
    // the main branch (the first of the longest) level with s; the others above it, in their order (what goes below a
    // card is its error port's)
    expect(at(placed)).toMatchObject({ s: [0, 2 * PORT_GAP], a: [CARD_WIDTH + 48, 2 * PORT_GAP], b: [CARD_WIDTH + 48, 0], c: [CARD_WIDTH + 48, PORT_GAP] });
  });

  test('room for the longest name of the card (Distinct: duplicates), also after the unnamed-looking first output', () => {
    const placed = arrange([card('d', 'distinct', 0, 0), card('e', 'log', 0, 0)], [edge('d', 'e')]);
    // "duplicates": 10 letters → 10 × 6.5 + 24 = 89 → 96 (whole grid steps)
    expect(at(placed)).toMatchObject({ e: [CARD_WIDTH + 96, 0] });
  });

  test("a Lookup lines up with its first input; the second source's card on the next row", () => {
    const nodes = [card('a', 'mapper', 0, 0), card('b', 'sort', 0, 100), card('u', 'lookup', 0, 0)];
    const placed = arrange(nodes, [edge('a', 'u'), edge('b', 'u', 'out-0', 'in-1')]);
    // room before the Lookup for its inputs' names (input, lookup)
    expect(at(placed)).toEqual({ a: [0, 0], b: [0, PORT_GAP], u: [CARD_WIDTH + 64, 0] });
  });

  test('a group is resized around the cards that were inside it, with room for its title', () => {
    const group = { id: 'g', type: 'group', position: { x: -100, y: -100 }, width: 900, height: 700, data: {} };
    const placed = arrange([group, card('a', 'mapper', 0, 0), card('b', 'sort', 400, 300)], [edge('a', 'b')]);
    // cards at (0, 0) and (160, 0); the box: 32 left, 48 above, 32 right of the second card, 32 below
    expect(placed[0]).toMatchObject({ position: { x: -32, y: -48 }, width: 2 * CARD_WIDTH + 64, height: 64 + 48 + 32 });
  });

  test('groups never overlap: a group fed by another one moves right of it; groups of separate flows go down', () => {
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
      [green, blue, yellow, card('a', 'typescript', 0, 0), card('b', 'sqlserver', 0, 140), card('u', 'lookup', 400, 0)],
      [edge('a', 'u'), edge('b', 'u', 'out-0', 'in-1')],
    ) as Sized[];
    const box = (id: string) => boxOf(placed.find(n => n.id === id)!);

    expect(apart(box('blue'), box('yellow'))).toBe(true);
    expect(within(box('blue'), box('green'))).toBe(true);
    expect(within(box('yellow'), box('green'))).toBe(true);
  });

  test('a loose card going out of a group and back in does not open a gap in the group: it moves above the box', () => {
    // as in the screenshot: start → aggregate → http → router → end inside the group; start → grid (outside) → router
    const group = { id: 'g', type: 'group', position: { x: -50, y: -50 }, width: 900, height: 200, data: {} };
    const placed = arrange(
      [group, card('s', 'start', 0, 0), card('ag', 'aggregate', 170, 0), card('h', 'http-request', 340, 0), card('r', 'router', 600, 0), card('e', 'end', 800, 0), card('dg', 'datagrid', 300, 400)],
      [edge('s', 'ag'), edge('s', 'dg'), edge('ag', 'h'), edge('h', 'r'), edge('dg', 'r'), edge('r', 'e')],
    ) as { id: string; position: { x: number; y: number }; width?: number; height?: number }[];
    const x = (id: string) => placed.find(n => n.id === id)!.position.x;
    const box = placed.find(n => n.id === 'g')!;
    const grid = placed.find(n => n.id === 'dg')!;

    // the Router right after the HTTP Request (no empty column between them); the End after the Router's else (its name)
    expect(x('r') - x('h')).toBe(CARD_WIDTH);
    expect(x('e') - x('r')).toBe(CARD_WIDTH + 64);
    // the Aggregate after the Start's 2x
    expect(x('ag') - x('s')).toBe(CARD_WIDTH + 48);
    // the Data Grid out of the group's box, above it (moving up is preferred to down)
    expect(grid.position.y + 64).toBeLessThanOrEqual(box.position.y);
  });

  test('a loose card between cards of a group never ends on top of another card: the group stays whole', () => {
    type Placed = { id: string; position: { x: number; y: number } };
    const flow = (groupWidth: number) =>
      arrange(
        [
          { id: 'g', type: 'group', position: { x: -50, y: -50 }, width: groupWidth, height: 200, data: {} },
          card('s', 'start', 0, 0), card('ag', 'aggregate', 170, 0), card('h', 'http-request', 340, 0),
          card('r', 'router', 600, 300), card('e', 'end', 900, 0), card('dg', 'datagrid', 300, 400),
        ],
        [edge('s', 'ag'), edge('s', 'dg'), edge('ag', 'h'), edge('h', 'r'), edge('dg', 'r'), edge('r', 'e')],
      ) as Placed[];
    const apart = (placed: Placed[]) => {
      const cards = placed.filter(n => n.id !== 'g');
      return cards.every((a, i) =>
        cards.slice(i + 1).every(b => Math.abs(a.position.x - b.position.x) >= CARD_WIDTH || Math.abs(a.position.y - b.position.y) >= PORT_GAP),
      );
    };

    // the Router out of the group, the End out too: the Router goes past the box and the End moves along after it
    const bothOut = flow(1100);
    const x = (placed: Placed[], id: string) => placed.find(n => n.id === id)!.position.x;
    expect(apart(bothOut)).toBe(true);
    expect(x(bothOut, 'e')).toBeGreaterThan(x(bothOut, 'r'));

    // the Router out, the End in the group: the Router goes above the box, nothing on top of the End
    const endIn = flow(1300);
    expect(apart(endIn)).toBe(true);
  });

  test('moving a group away never leaves two loose cards on top of each other (the Lookup and the Mapper)', () => {
    type Placed = { id: string; position: { x: number; y: number } };
    // as in the screenshot: Start → Mapper (loose), Start → Mapper → Sort → Router → End in a group, Start → both
    // inputs of a Lookup (loose); the Mapper and the Lookup go to the End. Whatever order the edges were drawn in.
    const nodes = [
      card('s', 'start', 40, 248), card('m1', 'mapper', 410, 40),
      { id: 'g', type: 'group', position: { x: 380, y: 200 }, width: 770, height: 140, data: {} },
      card('m2', 'mapper', 410, 248), card('so', 'sort', 570, 248), card('r', 'router', 730, 248), card('e', 'end', 955, 248),
      card('l', 'lookup', 665, 487),
    ];
    const rest = [edge('m2', 'so'), edge('so', 'r'), edge('r', 'e'), edge('m1', 'e'), edge('l', 'e')];
    const fromStart = [edge('s', 'm1'), edge('s', 'm2'), edge('s', 'l'), edge('s', 'l', 'out-0', 'in-1')];
    const orders = [fromStart, [fromStart[2]!, fromStart[3]!, fromStart[0]!, fromStart[1]!], [fromStart[1]!, fromStart[2]!, fromStart[0]!, fromStart[3]!], [fromStart[1]!, fromStart[0]!, fromStart[2]!, fromStart[3]!]];

    for (const order of orders) {
      const placed = arrange(nodes, [...order, ...rest]) as Placed[];
      const at = (id: string) => placed.find(n => n.id === id)!.position;
      // the Lookup takes two rows (its strip): nothing may sit in either
      const lookup = at('l');
      for (const other of ['s', 'm1', 'm2', 'so', 'r', 'e']) {
        const p = at(other);
        const sameColumn = Math.abs(p.x - lookup.x) < CARD_WIDTH;
        const inRows = p.y > lookup.y - PORT_GAP && p.y < lookup.y + 2 * PORT_GAP;
        expect(`${other}: ${sameColumn && inRows}`).toBe(`${other}: false`);
      }
    }
  });

  test('what handles the errors (Divert) goes below the path that works, one column after', () => {
    const placed = arrange(
      [card('m', 'mapper', 0, 0, { onError: 'divert' }), card('ok', 'sort', 0, 0), card('fix', 'log', 0, 0)],
      [edge('m', 'ok'), edge('m', 'fix', 'error')],
    );
    expect(at(placed)).toEqual({ m: [0, 0], ok: [CARD_WIDTH, 0], fix: [CARD_WIDTH, PORT_GAP] });
  });

  test('separate flows one below the other; groups and loose cards are kept', () => {
    const group = { id: 'g', type: 'group', position: { x: 7, y: 7 }, data: {} };
    const placed = arrange([card('a', 'mapper', 0, 0), card('b', 'sort', 0, 50), group], []);
    expect(at(placed)).toEqual({ a: [0, 0], b: [0, PORT_GAP], g: [7, 7] });
  });

  test("a Lookup fed by a branch of the Start: its ports level with what feeds them; the branch above the main path, error targets below their card", () => {
    // as in a real flow: Start → HTTP → Split → Filter → Log → End, and Start → Mapper → (2x) two grids → Lookup → End
    const group = { id: 'g', type: 'group', position: { x: -320, y: -4032 }, width: 816, height: 384, data: {} };
    const nodes = [
      group,
      card('start', 'start', -496, -3584),
      card('end', 'end', 464, -3584),
      card('http', 'http-request', -288, -3584),
      card('split', 'split', -80, -3584),
      card('filter', 'filter', 80, -3584),
      card('log', 'log', 304, -3584),
      card('gridA', 'datagrid', -80, -3984),
      card('gridB', 'datagrid', -80, -3904),
      card('lookup', 'lookup', 176, -3984),
      card('mapper', 'mapper', -288, -3984),
      card('discard', 'discard', 304, -3744),
    ];
    const edges = [
      edge('start', 'http'),
      edge('split', 'filter'),
      edge('filter', 'log'),
      edge('log', 'end'),
      edge('gridA', 'lookup'),
      edge('gridB', 'lookup', 'out-0', 'in-1'),
      edge('mapper', 'gridA'),
      edge('mapper', 'gridB'),
      edge('start', 'mapper'),
      edge('lookup', 'end'),
      edge('http', 'split'),
      edge('lookup', 'discard', 'error', 'in-0'),
    ];
    for (const order of [edges, [...edges].reverse()]) {
      const placed = at(arrange(nodes, order));
      const [lx, ly] = placed.lookup!;
      // the Lookup's input (its top port) level with the grid feeding it, its lookup port (a row down) with the other one
      expect(ly).toBe(placed.gridA![1]);
      expect(placed.gridB![1]).toBe(ly + PORT_GAP);
      // room before the Lookup for its inputs' names
      expect(lx - placed.gridA![0]).toBeGreaterThanOrEqual(CARD_WIDTH + 64);
      // no two cards on the same spot
      const spots = Object.values(placed).map(([x, y]) => `${x},${y}`);
      expect(new Set(spots).size).toBe(spots.length);
      // the main path (Start → HTTP → … → End) on one row; the Mapper branch above it; what Lookup's error port feeds
      // right below the Lookup (under its two-row strip), so no red edge crosses the branch
      expect(placed.http![1]).toBe(placed.start![1]);
      expect(placed.split![1]).toBe(placed.start![1]);
      expect(placed.mapper![1]).toBeLessThan(placed.start![1]);
      expect(placed.discard![1]).toBe(ly + 2 * PORT_GAP);
      expect(placed.discard![1]).toBeLessThan(placed.start![1]);
    }
  });

  test("the room one card needs does not push the cards of another row in its column (they stay glued)", () => {
    // like the editor's test flow: start → (2x) mapper (top branch, with a Lookup's named inputs) and start → http → ts → split
    const nodes = [
      card('start', 'start', 0, 0),
      card('map', 'mapper', 0, 0),
      card('a', 'datagrid', 0, 0),
      card('b', 'datagrid', 0, 0),
      card('lookup', 'lookup', 0, 0),
      card('http', 'http-request', 0, 0),
      card('ts', 'typescript', 0, 0),
      card('split', 'split', 0, 0),
    ];
    const edges = [
      edge('start', 'http'),
      edge('start', 'map'),
      edge('map', 'a'),
      edge('map', 'b'),
      edge('a', 'lookup'),
      edge('b', 'lookup', 'out-0', 'in-1'),
      edge('http', 'ts'),
      edge('ts', 'split'),
    ];
    const placed = at(arrange(nodes, edges));
    const x = (id: string) => placed[id]![0];
    // the main row: http, ts, split one card width apart, whatever the Mapper's 2x or the Lookup's input names need
    expect(x('ts') - x('http')).toBe(CARD_WIDTH);
    expect(x('split') - x('ts')).toBe(CARD_WIDTH);
    // the top branch keeps its room: after the Mapper's 2x, and before the Lookup's input names
    expect(x('a') - x('map')).toBeGreaterThan(CARD_WIDTH);
    expect(x('lookup') - x('a')).toBeGreaterThan(CARD_WIDTH);
  });
});
