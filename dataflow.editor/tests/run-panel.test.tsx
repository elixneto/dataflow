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

  test("its memory peak, how much it grew, the process CPU and the components' active time; a tooltip says what they measure", () => {
    const html = panel({ startRssBytes: 50 * 1024 ** 2, peakRssBytes: 98 * 1024 ** 2, cpuMs: 94.4 });
    // the process CPU is the whole worker's; Components is the sum of the Active column
    expect(html).toMatch(/Memory 98\.0 MB peak \(\+48\.0 MB\) · Process CPU 94 ms · Components [\d.]+ ms/);
    expect(html).toMatch(/title="What the run&#x27;s worker process used\. Memory: its peak, Bun included.*Process CPU: the processing time of the whole worker process/);
  });

  test('dashes for a run without them (older runs)', () => {
    expect(panel(null)).toContain('Memory — · Process CPU —');
    expect(panel({ startRssBytes: null, peakRssBytes: 1024 ** 2, cpuMs: null })).toContain('Memory 1.0 MB peak · Process CPU —');
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

describe('what the Data tab shows, kept from one run to the next', () => {
  test('the component chosen stays; nothing chosen: the first after the Start', async () => {
    const { dataTabSelection } = await import('../src/pages/flow-editor/run-view');
    const record = mockRunRecord(flow, 'validation', new Date('2026-11-04T12:00:00Z'));
    expect(dataTabSelection(record, undefined)).toBe('f');
    expect(dataTabSelection(record, 'start')).toBe('start');
  });

  test('while the next run has not reached it, it waits on it; a run that ended without it (removed): the first after the Start', async () => {
    const { dataTabSelection } = await import('../src/pages/flow-editor/run-view');
    const record = mockRunRecord(flow, 'validation', new Date('2026-11-04T12:00:00Z'));
    const starting = { ...record, status: 'running' as const, components: record.components.filter(c => c.type === 'start') };
    expect(dataTabSelection(starting, 'f')).toBe('f');
    expect(dataTabSelection({ ...record, components: starting.components }, 'f')).toBe('start');
    expect(dataTabSelection(record, 'gone')).toBe('f');
  });

  test('chosen but not reached yet: it says so instead of showing another component', () => {
    const record = mockRunRecord(flow, 'validation', new Date('2026-11-04T12:00:00Z'));
    const starting = { ...record, status: 'running' as const, components: record.components.filter(c => c.type === 'start') };
    const html = renderToStaticMarkup(
      <RunPanel record={starting} running="test" onFocus={() => {}} pinned={new Set()} onPin={() => {}} onClose={() => {}} show={{ nodeId: 'f', port: 'out-0', at: 1 }} />,
    );
    expect(html).toContain('Not run yet');
  });
});

describe("the Metrics tab's timeline", () => {
  test('its axis is the run, or longer when a component closed after the run (finer times): no bar runs past it', async () => {
    const { timelineSpan } = await import('../src/pages/flow-editor/run-view');
    const record = mockRunRecord(flow, 'validation', new Date('2026-11-04T12:00:00Z'));
    const runStart = Date.parse(record.run.startedAt);
    const late = {
      ...record,
      durationMs: 1,
      components: record.components.map((c, i) => ({ ...c, start: new Date(runStart + i).toISOString(), durationMs: 1 })),
    };
    expect(timelineSpan(late, runStart)).toBe(record.components.length);
    expect(timelineSpan({ ...record, durationMs: 500, components: [] }, runStart)).toBe(500);
  });
});

describe("a component window's Last run tab", () => {
  test('how it ended, its counts and times, what came in and went out per port, and its own log lines', async () => {
    const { ComponentLastRun } = await import('../src/pages/flow-editor/run-panel');
    const record = mockRunRecord(flow, 'validation', new Date('2026-11-04T12:00:00Z'));
    const filter = record.components.find(c => c.nodeId === 'f')!;
    const html = renderToStaticMarkup(<ComponentLastRun c={{ ...filter, logs: [{ at: '2026-11-04T12:00:00.000Z', level: 'info', message: '3 to true and 1 to false.' }] }} />);
    expect(html).toContain('Input (4)');
    expect(html).toMatch(/role="tab" aria-selected="true"[^>]*>true \(3\)<\/button>/);
    expect(html).toContain('false (1)');
    expect(html).toMatch(/In <span[^>]*>4<\/span>/);
    expect(html).toContain('3 to true and 1 to false.');
  });

  test('the Start shows only its output, the End only its input', async () => {
    const { ComponentLastRun } = await import('../src/pages/flow-editor/run-panel');
    const record = mockRunRecord(flow, 'validation', new Date('2026-11-04T12:00:00Z'));
    const start = renderToStaticMarkup(<ComponentLastRun c={record.components.find(c => c.type === 'start')} />);
    expect(start).toContain('Output (4)');
    expect(start).not.toContain('Input (');
    const end = renderToStaticMarkup(<ComponentLastRun c={record.components.find(c => c.type === 'end')} />);
    expect(end).toContain('Input (');
    expect(end).not.toContain('Output (');
  });

  test('not run yet: it says so', async () => {
    const { ComponentLastRun } = await import('../src/pages/flow-editor/run-panel');
    expect(renderToStaticMarkup(<ComponentLastRun c={undefined} />)).toContain('Not run yet');
  });
});

describe('which run a Last run tab shows', () => {
  test('the marks say which runs they come from: the run shown and the full test run', async () => {
    const { runMarks } = await import('../src/editor/run/run-marks');
    const record = mockRunRecord(flow, 'execution', new Date('2026-11-04T12:00:00Z'));
    const full = mockRunRecord(flow, 'validation', new Date('2026-11-04T11:00:00Z'));
    const marks = runMarks({ ...record, from: { nodeId: 'f', label: 'Big' } }, false, undefined, full)!;
    expect(marks.about).toEqual({ mode: 'execution', from: 'Big', startedAt: record.run.startedAt });
    expect(marks.fullAbout).toEqual({ mode: 'validation', startedAt: full.run.startedAt });
  });

  test('its top line: Test run or Run for real, from which component, and when', async () => {
    const { ComponentLastRun } = await import('../src/pages/flow-editor/run-panel');
    const record = mockRunRecord(flow, 'validation', new Date('2026-11-04T12:00:00Z'));
    const filter = record.components.find(c => c.nodeId === 'f')!;
    const html = renderToStaticMarkup(<ComponentLastRun c={filter} about={{ mode: 'validation', from: 'Big', startedAt: '2026-10-30T12:00:00.000Z' }} />);
    expect(html).toMatch(/>Test run<\/span> · from Big · Oct 30 \d{2}:\d{2}:\d{2}\.000</);
    expect(renderToStaticMarkup(<ComponentLastRun c={filter} about={{ mode: 'execution', startedAt: new Date().toISOString() }} />)).toMatch(/>Run for real<\/span> · today /);
  });
});

describe("a run's errors, stacked", () => {
  const at = (s: number) => `2026-11-04T12:00:0${s}.000Z`;
  const failed = () => {
    const record = mockRunRecord(flow, 'validation', new Date('2026-11-04T12:00:00Z'));
    return {
      ...record,
      status: 'failed' as const,
      error: '"Big": $x is not defined',
      components: record.components.map(c =>
        c.nodeId === 'f'
          ? { ...c, status: 'failed' as const, logs: [
              { at: at(2), level: 'error' as const, message: '$x is not defined' },
              { at: at(1), level: 'warning' as const, message: 'Diverted to the error port: bad' },
              { at: at(3), level: 'error' as const, message: '$x is not defined' },
            ] }
          : c.type === 'end'
            ? { ...c, logs: [...c.logs, { at: at(4), level: 'error' as const, message: 'Run r1 finished (Failed) in 3 ms.' }] }
            : c,
      ),
    };
  };

  test('one per component and message, with how many times, the first time first; not the End closing line nor warnings', async () => {
    const { runErrors } = await import('../src/pages/flow-editor/run-view');
    expect(runErrors(failed())).toEqual([{ nodeId: 'f', message: '$x is not defined', count: 2, at: at(2) }]);
  });

  test('a run that ended with errors opens on the Errors tab, with the count, and says why it failed above the tabs', () => {
    const html = renderToStaticMarkup(<RunPanel record={failed()} running={null} onFocus={() => {}} pinned={new Set()} onPin={() => {}} onClose={() => {}} />);
    expect(html).toMatch(/role="alert"[^>]*>.*&quot;Big&quot;: \$x is not defined/);
    expect(html).toMatch(/aria-selected="true"[^>]*>errors<span[^>]*>2<\/span>/);
    expect(html).toContain('×2');
  });
});
