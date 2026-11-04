import { describe, expect, test } from 'bun:test';
import type { ComponentRun, RunProgress } from '@dataflow/core';
import { parseEvents } from '../src/data/flows/run-events';
import { runMarks } from '../src/editor/run/run-marks';

describe('following a run as it goes', () => {
  test('the stream is read in blocks; a block cut between two chunks waits for the rest', () => {
    const first = parseEvents('event: progress\ndata: {"a":1}\n\nevent: progress\ndata: {"a"');
    expect(first.events).toEqual([{ type: 'progress', data: '{"a":1}' }]);
    const second = parseEvents(first.rest + ':2}\n\nevent: done\ndata: {"b":3}\n\n');
    expect(second.events).toEqual([
      { type: 'progress', data: '{"a":2}' },
      { type: 'done', data: '{"b":3}' },
    ]);
    expect(second.rest).toBe('');
  });

  test('while it runs, the canvas marks come from the run so far (each component running or ended)', () => {
    const component = (nodeId: string, status: ComponentRun['status']): ComponentRun => ({
      nodeId, label: nodeId, type: 'mapper', status, inputs: {}, outputs: status === 'completed' ? { 'out-0': 1 } : {}, logs: [], inputSample: [], outputSample: {},
    });
    const progress: RunProgress = {
      run: { id: 'r', mode: 'validation', project: 'p', flow: 'f', startedAt: '' },
      parameters: {},
      status: 'running',
      durationMs: 300,
      components: [component('a', 'completed'), component('b', 'running'), component('c', 'not-run')],
    };
    const marks = runMarks(progress, true)!;
    expect(marks.running).toBe(true);
    expect([...marks.byNode.values()].map(c => [c.nodeId, c.status])).toEqual([['a', 'completed'], ['b', 'running'], ['c', 'not-run']]);
  });
});
