import { describe, expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import type { ComponentRun } from '@dataflow/core';
import { Timeline } from '../src/pages/flow-editor/run-panel';

const run = { nodeId: 'w', status: 'completed', start: '2026-11-05T16:11:54.452Z', durationMs: 12, activeTimeMs: 1.68, waitingMs: 7.79, inputs: {}, outputs: {}, logs: [], inputSample: [], outputSample: {} } as unknown as ComponentRun;

describe('the Metrics timeline', () => {
  test('as the table: the Open track, then Active, then Waiting, lighter to darker; the tooltip in the same order', () => {
    const html = renderToStaticMarkup(<Timeline c={run} runStart={Date.parse('2026-11-05T16:11:54.430Z')} runMs={35} />);
    const parts = [...html.matchAll(/data-part="(\w+)" class="[^"]*?(bg-primary(?:\/\d+)?)/g)].map(([, part, shade]) => [part, shade]);
    expect(parts).toEqual([
      ['active', 'bg-primary/55'],
      ['waiting', 'bg-primary'],
    ]);
    // the open track is the lightest, and comes first: the active and waiting parts sit at its end
    expect(html).toMatch(/justify-end[^"]*bg-primary\/25|bg-primary\/25[^"]*justify-end/);
    expect(html).toMatch(/title="Open 12 ms \(from [^)]+\) · active 1.68 ms · waiting 7.79 ms"/);
  });
});
