import { describe, expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { newFlowFile, type ComponentRun, type FlowFile } from '@dataflow/core';
import { EnvelopeCount } from '../src/editor/component-node';
import { mockRunRecord } from './fixtures/mock-run';
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
    // the Filter's ports as tabs with their names and counts; the false port (clicked) shown, filling the column
    expect(html).toMatch(/role="tab" aria-selected="false"[^>]*>true \(3\)<\/button>/);
    expect(html).toMatch(/role="tab" aria-selected="true"[^>]*>false \(1\)<\/button>/);
    expect(html).toMatch(/<section data-shown="true"[^>]*><h4[^>]*>Output false \(1\)<\/h4>/);
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

describe('a run on the server: queued, Stop, stopped', () => {
  const panel = (props: Partial<Parameters<typeof RunPanel>[0]>) =>
    renderToStaticMarkup(<RunPanel record={null} running={null} onFocus={() => {}} pinned={new Set()} onPin={() => {}} onClose={() => {}} {...props} />);

  test('waiting for a free worker it says Queued; while it runs, Stop (Stopping… once asked)', () => {
    const queued = panel({ running: 'test', queued: true, onStop: () => {} });
    expect(queued).toContain('Queued…');
    expect(queued).toContain('title="Waiting for a free worker"');
    expect(queued).toMatch(/title="Stop the run"[^>]*>.*Stop<\/button>/);

    const record = { ...mockRunRecord(flow, 'validation', new Date('2026-11-04T12:00:00Z')), status: 'running' as const };
    const running = panel({ record, running: 'test', onStop: () => {} });
    expect(running).toContain('Running…');
    expect(running).not.toContain('Queued…');
    expect(panel({ record, running: 'test', onStop: () => {}, stopping: true })).toMatch(/Stopping…[\s\S]*disabled="" title="Stop the run"/);
    // no run going on: no Stop
    expect(panel({ record: mockRunRecord(flow, 'validation', new Date()), running: null })).not.toContain('Stop the run');
  });

  test('a run that Stop ended shows Stopped, not Failed', () => {
    const record = { ...mockRunRecord(flow, 'validation', new Date('2026-11-04T12:00:00Z')), status: 'failed' as const, error: 'Run cancelled.' };
    const html = panel({ record });
    expect(html).toContain('Stopped');
    expect(html).not.toContain('>Failed<');
    expect(panel({ record: { ...record, error: 'Boom' } })).toContain('Failed');
  });
});

describe("what the run's worker used, in the panel header", () => {
  const panel = (usage: Parameters<typeof RunPanel>[0]['usage']) =>
    renderToStaticMarkup(
      <RunPanel record={mockRunRecord(flow, 'validation', new Date('2026-11-04T12:00:00Z'))} usage={usage} running={null} onFocus={() => {}} pinned={new Set()} onPin={() => {}} onClose={() => {}} />,
    );

  test('its memory peak, how much it grew, its CPU; a tooltip says what they measure', () => {
    const html = panel({ startRssBytes: 50 * 1024 ** 2, peakRssBytes: 98 * 1024 ** 2, cpuMs: 94.4 });
    expect(html).toContain('Memory 98.0 MB peak (+48.0 MB) · CPU 94 ms');
    expect(html).toMatch(/title="What the run&#x27;s worker process used\. Memory: its peak, Bun included/);
  });

  test('dashes for a run without them (older runs)', () => {
    expect(panel(null)).toContain('Memory — · CPU —');
    expect(panel({ startRssBytes: null, peakRssBytes: 1024 ** 2, cpuMs: null })).toContain('Memory 1.0 MB peak · CPU —');
  });
});

describe('pins and Run from here in the panel', () => {
  test('a pin keeps what went out of the component in the last run, per port (a copy)', async () => {
    const { pinnedOutput } = await import('../src/editor/run/run-marks');
    const record = mockRunRecord(flow, 'validation', new Date('2026-11-04T12:00:00Z'));
    const filter = record.components.find(c => c.nodeId === 'f')!;
    const pinned = pinnedOutput(filter)!;
    expect(pinned).toEqual(filter.outputSample);
    expect(pinned).not.toBe(filter.outputSample);
    expect(pinnedOutput(undefined)).toBeUndefined();
  });

  test('a run from a component says so in the header; a skipped component says why', () => {
    const record = mockRunRecord(flow, 'validation', new Date('2026-11-04T12:00:00Z'));
    const components = record.components.map(c => (c.nodeId === 'start' ? { ...c, status: 'skipped' as const } : c));
    const html = renderToStaticMarkup(
      <RunPanel record={{ ...record, components, from: { nodeId: 'f', label: 'Big' } }} running={null} onFocus={() => {}} pinned={new Set()} onPin={() => {}} onClose={() => {}} show={{ nodeId: 'f', port: 'out-0', at: 1 }} />,
    );
    expect(html).toContain('Test run · from Big');
    expect(html).toContain('aria-label="Skipped: it only feeds pinned components"');
  });
});

test('after a Run from here, the canvas still knows the full test run (Run from here is offered by it)', async () => {
  const { runMarks, runActions } = await import('../src/editor/run/run-marks');
  const full = mockRunRecord(flow, 'validation', new Date('2026-11-04T12:00:00Z'));
  const partial = { ...full, from: { nodeId: 'end', label: 'End' }, components: full.components.filter(c => c.nodeId === 'end') };
  const marks = runMarks(partial, false, undefined, full)!;
  // the Filter did not run in the Run from here, but something reached it in the full run
  expect(marks.byNode.has('f')).toBe(false);
  expect(runActions(marks.full?.get('f'), false).runFromHere).toBe(true);
});
