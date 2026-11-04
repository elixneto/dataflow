import { describe, expect, test } from 'bun:test';
import type { Edge, Node } from '@xyflow/react';
import { CLIPBOARD_MARKER, copiedComponents, pastedComponents } from '../src/editor/clipboard';

const node = (id: string, type: string, extra: Partial<Node> & { data?: Record<string, unknown> } = {}): Node => ({
  id,
  type: 'component',
  position: { x: 100, y: 50 },
  ...extra,
  data: { type, config: { a: 1 }, ...extra.data },
});

const canvas = (): { nodes: Node[]; edges: Edge[] } => ({
  nodes: [
    node('start', 'start', { selected: true }),
    node('m', 'mapper', { selected: true, data: { label: 'Prices', pinned: { 'out-0': [{ x: 1 }] } } }),
    node('f', 'filter', { selected: true, position: { x: 10, y: 20 }, parentId: 'g' }),
    node('l', 'log'),
    { id: 'g', type: 'group', position: { x: 300, y: 400 }, data: { title: '', color: '' } },
  ],
  edges: [
    { id: 'e1', source: 'start', sourceHandle: 'out-0', target: 'm', targetHandle: 'in-0' },
    { id: 'e2', source: 'm', sourceHandle: 'out-0', target: 'f', targetHandle: 'in-0' },
    { id: 'e3', source: 'f', sourceHandle: 'out-0', target: 'l', targetHandle: 'in-0' },
  ],
});

describe('copy and paste of components', () => {
  test('copies the selected components (not the Start), the edges between them, without pins; nothing selected: nothing', () => {
    const { nodes, edges } = canvas();
    const copied = JSON.parse(copiedComponents(nodes, edges)!);
    expect(copied.marker).toBe(CLIPBOARD_MARKER);
    expect(copied.nodes.map((n: { id: string }) => n.id)).toEqual(['m', 'f']);
    // a node in a group: its place on the canvas
    expect(copied.nodes[1].position).toEqual({ x: 310, y: 420 });
    expect(copied.nodes[0].pinned).toBeUndefined();
    expect(copied.nodes[0].label).toBe('Prices');
    expect(copied.edges).toEqual([{ source: 'm', sourcePort: 'out-0', target: 'f', targetPort: 'in-0' }]);
    expect(copiedComponents(nodes.map(n => ({ ...n, selected: false })), edges)).toBeNull();
    expect(copiedComponents([node('start', 'start', { selected: true })], [])).toBeNull();
  });

  test('pastes them with new ids, a name of their own, selected, connected as they were', () => {
    const { nodes, edges } = canvas();
    const text = copiedComponents(nodes, edges)!;
    const pasted = pastedComponents(text, nodes, { x: 0, y: 0 })!;
    expect(pasted.nodes).toHaveLength(2);
    const [m, f] = pasted.nodes;
    expect(m!.id).not.toBe('m');
    expect(m!.data).toMatchObject({ type: 'mapper', config: { a: 1 }, label: 'Prices 2' });
    expect(pasted.nodes.every(n => n.selected)).toBe(true);
    expect(pasted.edges).toEqual([expect.objectContaining({ source: m!.id, target: f!.id, sourceHandle: 'out-0', targetHandle: 'in-0' })]);
  });

  test('placed as a whole wherever this canvas is: the top left corner at the pointer, or the middle at the middle of the screen; again: a step further', async () => {
    const { CARD_HEIGHT, CARD_WIDTH } = await import('../src/editor/node-geometry');
    const { nodes, edges } = canvas();
    const text = copiedComponents(nodes, edges)!;
    // copied at (100, 50) and (310, 420): the layout is kept
    const atPointer = pastedComponents(text, [], { x: 5000, y: -3000 })!;
    expect(atPointer.nodes.map(n => n.position)).toEqual([{ x: 5000, y: -3000 }, { x: 5210, y: -2630 }]);
    const centered = pastedComponents(text, [], { x: 0, y: 0 }, { center: true })!;
    const width = 310 + CARD_WIDTH - 100;
    const height = 420 + CARD_HEIGHT - 50;
    expect(centered.nodes[0]!.position).toEqual({ x: -width / 2, y: -height / 2 });
    expect(pastedComponents(text, [], { x: 5000, y: -3000 }, { offset: 32 })!.nodes[0]!.position).toEqual({ x: 5032, y: -2968 });
  });

  test('anything else is not ours (the browser pastes it); a Start or an unknown component in it is left out', () => {
    expect(pastedComponents('hello', [], { x: 0, y: 0 })).toBeNull();
    expect(pastedComponents('{"a": 1}', [], { x: 0, y: 0 })).toBeNull();
    const text = JSON.stringify({
      marker: CLIPBOARD_MARKER,
      version: 1,
      nodes: [
        { id: 's', type: 'start', position: { x: 0, y: 0 }, config: {} },
        { id: 'x', type: 'no-such-thing', position: { x: 0, y: 0 }, config: {} },
        { id: 'm', type: 'mapper', position: { x: 0, y: 0 } },
      ],
      edges: [{ source: 's', sourcePort: 'out-0', target: 'm', targetPort: 'in-0' }],
    });
    const pasted = pastedComponents(text, [], { x: 0, y: 0 })!;
    expect(pasted.nodes.map(n => n.data.type)).toEqual(['mapper']);
    expect(pasted.edges).toEqual([]);
  });
});
