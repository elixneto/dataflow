import { describe, expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { newFlowFile, type ComponentRun, type FlowFile } from '@dataflow/core';
import { EnvelopeCount } from '../src/editor/component-node';
import { mockRunRecord } from '../src/editor/run/mock-run';
import { RunPanel } from '../src/pages/flow-editor/run-panel';

const flow: FlowFile = {
  ...newFlowFile('Orders', 'f1'),
  nodes: [
    { id: 'start', type: 'start', position: { x: 0, y: 0 }, config: { acceptsInput: true, testInput: '[{"id": 1}, {"id": 2}, {"id": 3}, {"id": 4}]' } },
    { id: 'f', type: 'filter', label: 'Big', position: { x: 160, y: 0 }, config: { condition: 'true' } },
    { id: 'end', type: 'end', position: { x: 320, y: 0 }, config: {} },
  ],
  edges: [
    { source: 'start', sourcePort: 'out-0', target: 'f', targetPort: 'in-0' },
    { source: 'f', sourcePort: 'out-0', target: 'end', targetPort: 'in-0' },
  ],
};

describe("a port's envelope count on the canvas", () => {
  test('is a button: "Show N envelopes", that does not drag the card nor start an edge (nodrag)', () => {
    const html = renderToStaticMarkup(<EnvelopeCount count={3} tone="ok" onShow={() => {}} />);
    expect(html).toContain('<button type="button" title="Show 3 envelopes" aria-label="Show 3 envelopes"');
    expect(html).toMatch(/class="nodrag nopan [^"]*cursor-pointer/);
    expect(renderToStaticMarkup(<EnvelopeCount count={1} tone="error" />)).toContain('Show 1 envelope"');
  });

  test("clicked, the run panel opens on the Data tab with that component and that port's envelopes in view", () => {
    const record = mockRunRecord(flow, 'validation', new Date('2026-11-04T12:00:00Z'));
    const html = renderToStaticMarkup(
      <RunPanel record={record} running={null} onFocus={() => {}} pinned={new Set()} onPin={() => {}} onClose={() => {}} show={{ nodeId: 'f', port: 'out-1', at: 1 }} />,
    );
    expect(html).toContain('aria-selected="true" class="rounded-md px-2.5 py-1 text-xs capitalize transition-colors bg-accent font-medium">data');
    // the Filter selected in the list, its false port marked
    expect(html).toMatch(/bg-accent font-medium"><svg[^>]*>.*?<\/svg><span class="truncate">Big<\/span>/);
    expect(html).toMatch(/<section data-shown="true"[^>]*><h4[^>]*>Output out-1 \(1\)<\/h4>/);
  });
});

describe("the run panel's choices, kept in this browser tab", () => {
  test('the Data view (Table/JSON) and the tab come back as stored; anything else or no storage: the default', async () => {
    const { readChoice, rememberChoice } = await import('../src/editor/run/run-choices');
    const store = new Map<string, string>();
    const storage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v) };
    expect(readChoice('dataflow.run.dataView', ['table', 'json'] as const, 'table', storage)).toBe('table');
    rememberChoice('dataflow.run.dataView', 'json', storage);
    expect(readChoice('dataflow.run.dataView', ['table', 'json'] as const, 'table', storage)).toBe('json');
    store.set('dataflow.run.tab', 'nonsense');
    expect(readChoice('dataflow.run.tab', ['logs', 'metrics', 'data'] as const, 'logs', storage)).toBe('logs');
    expect(readChoice('dataflow.run.tab', ['logs', 'metrics', 'data'] as const, 'logs', undefined)).toBe('logs');
    const throwing = { getItem: () => { throw new Error('blocked'); } };
    expect(readChoice('dataflow.run.tab', ['logs', 'metrics', 'data'] as const, 'logs', throwing)).toBe('logs');
  });
});

describe('Pin output and Run from here come after a run', () => {
  test('Pin needs something out of the component (or it is pinned already), Run from here something in', async () => {
    const { runActions } = await import('../src/editor/run/run-marks');
    const run = (inputs: Record<string, number>, outputs: Record<string, number>): ComponentRun => ({
      nodeId: 'x',
      label: 'x',
      type: 'mapper',
      status: 'completed',
      inputs,
      outputs,
      logs: [],
      inputSample: [],
      outputSample: {},
    });
    expect(runActions(undefined, false)).toEqual({ pin: false, runFromHere: false });
    expect(runActions(undefined, true)).toEqual({ pin: true, runFromHere: false });
    expect(runActions(run({ 'in-0': 2 }, { 'out-0': 0, 'out-1': 0 }), false)).toEqual({ pin: false, runFromHere: true });
    expect(runActions(run({ 'in-0': 2 }, { 'out-0': 0, 'out-1': 1 }), false)).toEqual({ pin: true, runFromHere: true });
    expect(runActions(run({}, {}), false)).toEqual({ pin: false, runFromHere: false });
  });
});
