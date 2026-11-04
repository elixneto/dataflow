import { describe, expect, test } from 'bun:test';
import { dataTypeFromSamples, systemVariables, type RunRecord } from '@dataflow/core';
import { inputSamplesAfter, suggestionsFor, tokenAt } from '../src/editor/expression-variables';

describe("an expression field's suggestions", () => {
  test('the `$...` right before the cursor is what is being typed', () => {
    expect(tokenAt('$total > 10', 6)).toEqual({ start: 0, text: '$total' });
    expect(tokenAt('a + $response.bo', 16)).toEqual({ start: 4, text: '$response.bo' });
    expect(tokenAt('1 + 2', 5)).toBeNull();
    // in the middle: only what is before the cursor counts
    expect(tokenAt('$PARAMETERS.since + 1', 4)).toEqual({ start: 0, text: '$PAR' });
  });

  test('the paths starting with it (any case), not the one already typed; secrets by name only', () => {
    const variables = [
      { path: '$response', type: 'object' },
      { path: '$response.status', type: 'number', example: '200' },
      { path: '$response.body', type: 'object' },
      ...systemVariables([{ name: 'since', type: 'number', default: '10' }], [{ name: 'REGION', value: 'eu' }], ['API_TOKEN']),
    ];
    expect(suggestionsFor(variables, '$resp').map(v => v.path)).toEqual(['$response', '$response.status', '$response.body']);
    expect(suggestionsFor(variables, '$response.').map(v => v.path)).toEqual(['$response.status', '$response.body']);
    expect(suggestionsFor(variables, '$response').map(v => v.path)).toEqual(['$response.status', '$response.body']);
    expect(suggestionsFor(variables, '$par').map(v => v.path)).toEqual(['$PARAMETERS', '$PARAMETERS.since']);
    expect(suggestionsFor(variables, '$SECRETS.').map(v => [v.path, v.type, v.example])).toEqual([['$SECRETS.API_TOKEN', 'secret', undefined]]);
  });

  test("a TypeScript component's Data comes from what reached it in the last runs (a component that got nothing keeps the earlier)", () => {
    const run = (samples: Record<string, object[]>): RunRecord => ({
      run: { id: 'r', mode: 'validation', project: 'p', flow: 'f', startedAt: '' },
      parameters: {},
      status: 'completed',
      end: '',
      durationMs: 1,
      components: Object.entries(samples).map(([nodeId, inputSample]) => ({
        nodeId, label: nodeId, type: 'typescript', status: 'completed', inputs: {}, outputs: {}, logs: [], inputSample: inputSample as never, outputSample: {},
      })),
    });
    let samples = inputSamplesAfter({}, run({ ts: [{ id: 1, name: 'a' }] }));
    samples = inputSamplesAfter(samples, run({ ts: [], other: [{ x: true }] }));
    expect(dataTypeFromSamples(samples.ts!)).toBe('{ id: number; name: string }');
    expect(Object.keys(samples)).toEqual(['ts', 'other']);
  });
});

describe("what earlier versions kept of the runs in this tab", () => {
  test('is removed (it may hold a credential a response carried); the current entries and the rest stay', async () => {
    const { dropOldRunCaches } = await import('../src/editor/expression-variables');
    const store = new Map([
      ['dataflow.inputSamples:f1', '{"h":[{"response":{"headers":{"set-cookie":"x"}}}]}'],
      ['dataflow.knownVariables:f1', '{}'],
      ['dataflow.inputSamples.v2:f1', '{}'],
      ['dataflow.run.tab', 'logs'],
    ]);
    const storage = {
      get length() {
        return store.size;
      },
      key: (i: number) => [...store.keys()][i] ?? null,
      removeItem: (name: string) => void store.delete(name),
    };
    dropOldRunCaches(storage);
    expect([...store.keys()]).toEqual(['dataflow.inputSamples.v2:f1', 'dataflow.run.tab']);
    expect(() => dropOldRunCaches(undefined)).not.toThrow();
  });
});
