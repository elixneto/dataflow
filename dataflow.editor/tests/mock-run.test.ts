import { describe, expect, test } from 'bun:test';
import { newFlowFile, type FlowFile } from '@dataflow/core';
import { mockRunRecord } from './fixtures/mock-run';

describe('the mock run (until the server runs flows)', () => {
  const flow: FlowFile = {
    ...newFlowFile('Orders', 'f1'),
    nodes: [
      { id: 'start', type: 'start', position: { x: 0, y: 0 }, config: { acceptsInput: true, testInput: '[{"id": 1}, {"id": 2}, {"id": 3}]' } },
      { id: 'h', type: 'http-request', label: 'WF :: Get', position: { x: 160, y: 0 }, config: { url: { value: 'https://wf.test/api', expression: false } } },
      { id: 'f', type: 'filter', position: { x: 320, y: 0 }, config: { condition: 'true' } },
      { id: 'loose', type: 'mapper', position: { x: 320, y: 200 }, config: {} },
      { id: 'end', type: 'end', position: { x: 480, y: 0 }, config: {} },
    ],
    edges: [
      { source: 'start', sourcePort: 'out-0', target: 'h', targetPort: 'in-0' },
      { source: 'h', sourcePort: 'out-0', target: 'f', targetPort: 'in-0' },
      { source: 'f', sourcePort: 'out-0', target: 'end', targetPort: 'in-0' },
    ],
  };

  test("a RunRecord in the core's format: the envelopes follow the edges, the HTTP answers, a loose component does not run", () => {
    const record = mockRunRecord(flow, 'validation', new Date('2026-11-04T12:00:00Z'));
    const of = (id: string) => record.components.find(c => c.nodeId === id)!;
    expect(record.components.map(c => c.nodeId)).toEqual(['start', 'h', 'f', 'end', 'loose']);
    expect(of('start').outputs).toEqual({ 'out-0': 3 });
    expect(of('h').outputs).toEqual({ 'out-0': 3 });
    expect((of('h').outputSample['out-0']![0] as { response: { status: number } }).response.status).toBe(200);
    expect(of('f').outputs).toEqual({ 'out-0': 3, 'out-1': 0 });
    expect(of('end').inputs).toEqual({ 'in-0': 3 });
    expect(of('loose').status).toBe('not-run');
    expect(record.status).toBe('with-warnings');
    expect(record.run).toMatchObject({ mode: 'validation', flow: 'Orders' });
  });

  test('the same flow gives the same numbers', () => {
    const now = new Date('2026-11-04T12:00:00Z');
    const a = mockRunRecord(flow, 'execution', now);
    const b = mockRunRecord(flow, 'execution', now);
    expect(a.components.map(c => [c.durationMs, c.outputs])).toEqual(b.components.map(c => [c.durationMs, c.outputs]));
  });
});
