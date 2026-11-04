import type { Edge } from '@xyflow/react';
import { CARD_HEIGHT, CARD_WIDTH, PORT_GAP } from './node-geometry';
import { inputPorts, outputPorts } from './ports';

/*
 * Arrange, as in the PoC but only left to right, and with the cards glued: each card goes in the column right after
 * what feeds it (one card width away, the output's bump in its input's hole) and at the height where its input meets
 * that output, so a straight line of cards reads like one piece. A branch (Copy's second output, Filter's false...)
 * goes a row down; a row is a card and the gap (PORT_GAP), so ports always line up. Cards that would land on another
 * go down to the next free row. Each flow that starts on its own (a card with no input edge) starts below the others.
 * A group is resized around the cards that were inside it (fitGroups), and groups never overlap: going into another
 * group skips a column, and a group still on top of another moves right or down, with all it holds (separate). Edges
 * between groups may get longer then.
 */

type Placed = { id: string; type?: string; position: { x: number; y: number }; data: object };

/** a component's type and config (only components are arranged) */
const component = (n: Placed) => n.data as { type: string; config?: Record<string, unknown> };

const portIndex = (handle?: string | null) => Number(handle?.match(/(\d+)$/)?.[1] ?? 0);

/** the nodes with the components in their new places (from the top left of where they are now); the rest as they are */
export function arrange<T extends Placed>(nodes: T[], edges: Edge[]): T[] {
  const components = nodes.filter(n => n.type === 'component' && component(n).type);
  if (components.length === 0) {
    return nodes;
  }

  const ids = new Set(components.map(c => c.id));
  const links = edges.filter(e => ids.has(e.source) && ids.has(e.target) && e.source !== e.target);
  const incoming = (id: string) => links.filter(e => e.target === id);
  const outgoing = (id: string) => links.filter(e => e.source === id);
  const byId = new Map(components.map(c => [c.id, c]));

  const span = (c: T) => Math.max(1, inputPorts(component(c).type, component(c).config).length, outputPorts(component(c).type, component(c).config).length);
  const tree = groupTree(nodes, components, span);

  // column: the longest way from a card with no input edge (a cycle stops at the cards already counted). Going into
  // another group (or out of one) skips a column, so the groups' boxes have room between them.
  const column = new Map<string, number>();
  const columnOf = (id: string, seen = new Set<string>()): number => {
    const known = column.get(id);
    if (known !== undefined) {
      return known;
    }

    if (seen.has(id)) {
      return 0;
    }

    seen.add(id);
    const value = Math.max(0, ...incoming(id).map(e => columnOf(e.source, seen) + (tree.cardParent.get(e.source) === tree.cardParent.get(id) ? 1 : 2)));
    column.set(id, value);
    return value;
  };
  components.forEach(c => columnOf(c.id));

  // rows taken in each column; a card with several ports on a side takes as many rows (its strip goes down)
  const taken = new Map<number, Set<number>>();
  const free = (col: number, row: number, rows: number) => Array.from({ length: rows }, (_, i) => !taken.get(col)?.has(row + i)).every(Boolean);
  const take = (col: number, row: number, rows: number) => {
    const set = taken.get(col) ?? new Set<number>();
    Array.from({ length: rows }, (_, i) => set.add(row + i));
    taken.set(col, set);
  };
  const lowest = () => Math.max(-1, ...[...taken.values()].flatMap(rows => [...rows]));

  const row = new Map<string, number>();
  const place = (c: T, wanted: number) => {
    const col = column.get(c.id)!;
    let r = Math.max(0, wanted);
    while (!free(col, r, span(c))) {
      r++;
    }

    take(col, r, span(c));
    row.set(c.id, r);
  };

  // depth first from each start, in the order they are on screen (top to bottom): a whole branch before the next
  const visit = (c: T) => {
    for (const edge of [...outgoing(c.id)].sort((a, b) => portIndex(a.sourceHandle) - portIndex(b.sourceHandle))) {
      const next = byId.get(edge.target)!;
      if (row.has(next.id)) {
        continue;
      }

      // wait for every card that feeds it (a Union's inputs), then line up with the one on its first input
      const feeders = incoming(next.id);
      if (feeders.some(f => !row.has(f.source))) {
        continue;
      }

      const first = [...feeders].sort((a, b) => portIndex(a.targetHandle) - portIndex(b.targetHandle))[0]!;
      place(next, row.get(first.source)! + portIndex(first.sourceHandle) - portIndex(first.targetHandle));
      visit(next);
    }
  };

  const starts = components.filter(c => incoming(c.id).length === 0).sort((a, b) => a.position.y - b.position.y || a.position.x - b.position.x);
  for (const start of starts) {
    place(start, lowest() + 1);
    visit(start);
  }

  // what is left (only in a cycle, or fed by a card left out): below everything, in its column
  for (const c of components.filter(c => !row.has(c.id))) {
    place(c, lowest() + 1);
    visit(c);
  }

  const left = Math.min(...components.map(c => c.position.x));
  const top = Math.min(...components.map(c => c.position.y));
  const moved = new Map(components.map(c => [c.id, { x: left + column.get(c.id)! * CARD_WIDTH, y: top + row.get(c.id)! * PORT_GAP }]));

  const groups = fitAndSeparate(tree, components, moved);
  return nodes.map(n => {
    const position = moved.get(n.id);
    const group = groups.get(n.id);
    return position ? { ...n, position } : group ? { ...n, position: { x: group.x, y: group.y }, width: group.w, height: group.h } : n;
  });
}

type Box = { x: number; y: number; w: number; h: number };

/** room inside a group around its cards: the title on top, the output bump on the right */
const GROUP_PADDING = { top: 48, right: 32, bottom: 32, left: 32 };
/** between the boxes of two groups (or a group and a card outside it) after the arrange */
const GROUP_GAP = 32;

const inside = (a: Box, b: Box) => a.x >= b.x && a.y >= b.y && a.x + a.w <= b.x + b.w && a.y + a.h <= b.y + b.h;
const overlap = (a: Box, b: Box, gap: number) => a.x < b.x + b.w + gap && b.x < a.x + a.w + gap && a.y < b.y + b.h + gap && b.y < a.y + a.h + gap;
const area = (b: Box) => b.w * b.h;
const snap = (value: number, step = 16) => Math.round(value / step) * step;
const snapUp = (value: number, step = 16) => Math.ceil(value / step) * step;

type Tree = {
  groups: Placed[];
  /** the smallest group around each card / each group, from where they are before the arrange */
  cardParent: Map<string, string | undefined>;
  groupParent: Map<string, string | undefined>;
  /** the outermost group a card is in (undefined: in none) */
  top: (cardId: string) => string | undefined;
  cardBox: (c: Placed, at: { x: number; y: number }) => Box;
};

/** which group each card is in (as in the PoC: the smallest group around it entirely) */
function groupTree<T extends Placed>(nodes: T[], components: T[], span: (c: T) => number): Tree {
  const sized = (n: Placed) => n as Placed & { width?: number; height?: number; measured?: { width?: number; height?: number } };
  const groups = nodes.filter(n => n.type === 'group');
  const groupBox = (g: Placed): Box => ({ x: g.position.x, y: g.position.y, w: sized(g).measured?.width ?? sized(g).width ?? 0, h: sized(g).measured?.height ?? sized(g).height ?? 0 });
  const cardBox = (c: Placed, at: { x: number; y: number }): Box => ({ x: at.x, y: at.y, w: CARD_WIDTH, h: CARD_HEIGHT + (span(c as T) - 1) * PORT_GAP });

  const parentOf = (box: Box, self?: string) =>
    groups
      .filter(g => g.id !== self && inside(box, groupBox(g)) && area(groupBox(g)) > area(box))
      .sort((a, b) => area(groupBox(a)) - area(groupBox(b)))[0]?.id;
  const cardParent = new Map(components.map(c => [c.id, parentOf(cardBox(c, c.position))]));
  const groupParent = new Map(groups.map(g => [g.id, parentOf(groupBox(g), g.id)]));
  const outermost = (group: string | undefined): string | undefined => {
    for (let g = group, depth = 0; g && depth < groups.length; depth++) {
      const parent = groupParent.get(g);
      if (!parent) {
        return g;
      }

      g = parent;
    }

    return group;
  };

  return { groups, cardParent, groupParent, top: id => outermost(cardParent.get(id)), cardBox };
}

/**
 * As in the PoC, a group goes with the cards that were entirely inside it: after the arrange it is resized to wrap
 * them (and the groups inside it), with room for its title; a group without cards stays as it is. And no group
 * overlaps another: from the innermost level out, the blocks side by side in the same place (the groups and the loose
 * cards directly inside a group, or on the canvas) are pulled apart (separate), then that group is fitted again around
 * them. Inside a block nothing moves.
 */
function fitAndSeparate(tree: Tree, components: Placed[], moved: Map<string, { x: number; y: number }>) {
  const fitted = new Map<string, Box>();
  const depth = (g: string) => {
    let d = 0;
    for (let p = tree.groupParent.get(g); p && d < tree.groups.length; p = tree.groupParent.get(p)) {
      d++;
    }

    return d;
  };

  // what each group holds, all levels down (to move it as one), and its direct cards / groups (to fit it)
  const holds = (outer: string, g: string | undefined): boolean => {
    for (let p = g, d = 0; p && d <= tree.groups.length; p = tree.groupParent.get(p), d++) {
      if (p === outer) {
        return true;
      }
    }

    return false;
  };
  const hasCards = (g: string) => components.some(c => holds(g, tree.cardParent.get(c.id)));
  const directCards = (container: string | undefined) => components.filter(c => tree.cardParent.get(c.id) === container);
  const directGroups = (container: string | undefined) =>
    tree.groups.filter(g => tree.groupParent.get(g.id) === container && hasCards(g.id)).map(g => g.id);

  const fit = (g: string) => {
    const boxes = [...directCards(g).map(c => tree.cardBox(c, moved.get(c.id)!)), ...directGroups(g).map(inner => fitted.get(inner)!)];
    const x = snap(Math.min(...boxes.map(b => b.x)) - GROUP_PADDING.left);
    const y = snap(Math.min(...boxes.map(b => b.y)) - GROUP_PADDING.top);
    const right = Math.max(...boxes.map(b => b.x + b.w)) + GROUP_PADDING.right;
    const bottom = Math.max(...boxes.map(b => b.y + b.h)) + GROUP_PADDING.bottom;
    fitted.set(g, { x, y, w: snap(right - x), h: snap(bottom - y) });
  };

  type Block = { cards: Placed[]; groups: string[]; isGroup: boolean; box: () => Box };
  const blocksIn = (container: string | undefined): Block[] => [
    ...directGroups(container).map(g => ({
      cards: components.filter(c => holds(g, tree.cardParent.get(c.id))),
      groups: [...fitted.keys()].filter(inner => holds(g, inner)),
      isGroup: true,
      box: () => fitted.get(g)!,
    })),
    ...directCards(container).map(c => ({ cards: [c], groups: [], isGroup: false, box: () => tree.cardBox(c, moved.get(c.id)!) })),
  ];

  const shift = (block: Block, dx: number, dy: number) => {
    block.cards.forEach(c => {
      const p = moved.get(c.id)!;
      moved.set(c.id, { x: p.x + dx, y: p.y + dy });
    });
    block.groups.forEach(g => {
      const b = fitted.get(g)!;
      fitted.set(g, { ...b, x: b.x + dx, y: b.y + dy });
    });
  };

  // while two blocks overlap (one of them a group: two loose cards are the arrange's business), the later one (to the
  // right, then below) moves right if it starts beside the other, down if below it, by whole columns / rows
  const separate = (blocks: Block[]) => {
    for (let round = 0; round < blocks.length * blocks.length + 10; round++) {
      const order = [...blocks].sort((a, b) => a.box().x - b.box().x || a.box().y - b.box().y);
      let clash: [Block, Block] | undefined;
      for (let i = 0; i < order.length && !clash; i++) {
        for (let j = i + 1; j < order.length && !clash; j++) {
          if ((order[i]!.isGroup || order[j]!.isGroup) && overlap(order[i]!.box(), order[j]!.box(), GROUP_GAP)) {
            clash = [order[i]!, order[j]!];
          }
        }
      }

      if (!clash) {
        return;
      }

      const [first, later] = clash;
      const a = first.box();
      const b = later.box();
      if (b.y >= a.y + a.h / 2) {
        shift(later, 0, snapUp(a.y + a.h + GROUP_GAP - b.y, PORT_GAP));
      } else {
        shift(later, snapUp(a.x + a.w + GROUP_GAP - b.x, CARD_WIDTH), 0);
      }
    }
  };

  // innermost groups first: pull apart what is inside, then fit the group around it; the canvas level last
  const withCards = tree.groups.map(g => g.id).filter(hasCards);
  for (const g of [...withCards].sort((a, b) => depth(b) - depth(a))) {
    separate(blocksIn(g));
    fit(g);
  }

  separate(blocksIn(undefined));
  return fitted;
}