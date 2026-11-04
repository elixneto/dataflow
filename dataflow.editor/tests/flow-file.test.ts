import { describe, expect, test } from 'bun:test';
import type { Edge, Node } from '@xyflow/react';
import { flowFromYaml, flowToYaml } from '@dataflow/core';
import { canvasToFlowFile, flowFileToCanvas } from '../src/editor/flow-file';
import { draftFingerprint } from '../src/editor/flow-save';

describe("the canvas as the core's flow file (Download)", () => {
  const nodes: Node[] = [
    { id: 'start', type: 'component', position: { x: 0, y: 0 }, data: { type: 'start', config: { parameters: [{ name: 'since', type: 'number', default: '1' }] } } },
    { id: 'm', type: 'component', position: { x: 160, y: 16 }, data: { type: 'mapper', config: { fields: [], onError: 'divert' }, label: ' Prices ', override: true, pinned: { 'out-0': [{ a: 1 }] }, notes: 'n' } },
    { id: 'end', type: 'component', position: { x: 320, y: 0 }, data: { type: 'end', config: {} } },
    { id: 'g', type: 'group', position: { x: -32, y: -48 }, measured: { width: 500, height: 200 }, data: { title: 'Read', color: '#3b82f6' } },
  ];
  const edges: Edge[] = [
    { id: 'e1', source: 'start', sourceHandle: 'out-0', target: 'm', targetHandle: 'in-0' },
    { id: 'e2', source: 'm', sourceHandle: 'error', target: 'end', targetHandle: 'in-0' },
  ];

  test('components with their config and place, edges with their ports (the error port too), groups with their size', () => {
    const file = canvasToFlowFile({ id: 'f1', name: 'Prices' }, nodes, edges);
    expect(file.nodes.map(n => n.id)).toEqual(['start', 'm', 'end']);
    expect(file.nodes[1]).toEqual({ id: 'm', type: 'mapper', label: 'Prices', position: { x: 160, y: 16 }, config: { fields: [], onError: 'divert' }, override: true, pinned: { 'out-0': [{ a: 1 }] }, notes: 'n' });
    expect(file.edges[1]).toEqual({ source: 'm', sourcePort: 'error', target: 'end', targetPort: 'in-0' });
    expect(file.groups).toEqual([{ id: 'g', title: 'Read', color: '#3b82f6', position: { x: -32, y: -48 }, size: { width: 500, height: 200 } }]);
  });

  test('the YAML it downloads reads back as the same flow', () => {
    const file = canvasToFlowFile({ id: 'f1', name: 'Prices' }, nodes, edges);
    expect(flowFromYaml(flowToYaml(file))).toEqual({ ok: true, value: file });
  });

  test('a saved flow opens on the canvas and, unchanged, is the same file (nothing to save)', () => {
    const file = canvasToFlowFile({ id: 'f1', name: 'Prices' }, nodes, edges);
    const opened = flowFileToCanvas(file);
    expect(opened.nodes[0]).toMatchObject({ id: 'g', type: 'group', width: 500, height: 200 });
    expect(opened.nodes.find(n => n.id === 'start')).toMatchObject({ deletable: false });
    expect(opened.nodes.find(n => n.id === 'm')).not.toHaveProperty('deletable');
    expect(draftFingerprint(canvasToFlowFile({ id: 'f1', name: 'Prices' }, opened.nodes, opened.edges))).toBe(draftFingerprint(file));
  });

  test('moving a component is a change to save; selecting it is not', () => {
    const file = canvasToFlowFile({ id: 'f1', name: 'Prices' }, nodes, edges);
    const selected = nodes.map(n => (n.id === 'm' ? { ...n, selected: true } : n));
    expect(draftFingerprint(canvasToFlowFile({ id: 'f1', name: 'Prices' }, selected, edges))).toBe(draftFingerprint(file));
    const moved = nodes.map(n => (n.id === 'm' ? { ...n, position: { x: 200, y: 16 } } : n));
    expect(draftFingerprint(canvasToFlowFile({ id: 'f1', name: 'Prices' }, moved, edges))).not.toBe(draftFingerprint(file));
  });
});

test('a pin of earlier versions (a bare `true`, no envelopes) loads as not pinned', async () => {
  const { flowFileToCanvas } = await import('../src/editor/flow-file');
  const { newFlowFile } = await import('@dataflow/core');
  const file = { ...newFlowFile('Old'), nodes: [...newFlowFile('Old').nodes, { id: 'h', type: 'http-request', position: { x: 0, y: 0 }, config: {}, pinned: true as never }] };
  const canvas = flowFileToCanvas(file);
  expect((canvas.nodes.find(n => n.id === 'h')!.data as { pinned?: unknown }).pinned).toBeUndefined();
});
