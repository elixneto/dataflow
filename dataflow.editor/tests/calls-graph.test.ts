import { describe, expect, test } from 'bun:test';
import type { FlowCall } from '@dataflow/core';
import { callsGraph, graphCalls, reached } from '../src/pages/project-flows/calls-graph';

const call = (from: string, to: string, nodeLabel = `Calls ${to}`, onErrorOf?: string): FlowCall => ({
  from,
  to,
  nodeId: `${from}-${to}-${nodeLabel}`,
  nodeLabel,
  ...(onErrorOf ? { onErrorOf, onErrorOfLabel: `Calls ${onErrorOf}` } : {}),
});
const data = {
  flows: [
    { id: 'a', name: 'Flow 1', folder: 'Imports', available: true },
    { id: 'b', name: 'Flow 2', folder: 'Imports', available: true },
    { id: 'c', name: 'Flow 3', folder: '', available: false },
    { id: 'd', name: 'Caller', folder: '', available: true },
    { id: 'lonely', name: 'Calls nothing', folder: '', available: true },
  ],
  calls: [call('a', 'b'), call('a', 'b', 'Again'), call('b', 'a'), call('a', 'c', 'Fallback', 'b'), call('d', 'a'), call('d', 'gone')],
  cycles: [['a', 'b', 'a']],
};

describe("the project's calls graph", () => {
  test('one arrow per caller and called flow, its Flow Invokers as the label; circular and on-error ones marked', () => {
    const arrows = graphCalls(data);
    expect(arrows.map(a => [a.id, a.label, a.circular, a.onError])).toEqual([
      ['a>b', 'Calls b, Again', true, false],
      ['b>a', 'Calls a', true, false],
      ['a>c', 'Fallback (on error of Calls b)', false, true],
      ['d>a', 'Calls a', false, false],
      ['d>gone', 'Calls gone', false, false],
    ]);
  });

  test('only flows that call or are called, callers left of what they call, a folder box around its flows', () => {
    const graph = callsGraph(data);
    expect(graph.flows.map(f => f.id).sort()).toEqual(['a', 'b', 'c', 'd', 'gone']);
    const at = (id: string) => graph.flows.find(f => f.id === id)!;
    expect(at('d').x).toBeLessThan(at('a').x);
    expect(at('gone')).toMatchObject({ name: 'Not found', known: false, available: false });
    const imports = graph.folders.find(f => f.name === 'Imports')!;
    for (const id of ['a', 'b']) {
      expect(at(id).x).toBeGreaterThanOrEqual(imports.x);
      expect(at(id).y).toBeGreaterThan(imports.y);
      expect(at(id).y).toBeLessThan(imports.y + imports.height);
    }
    expect(graph.folders).toHaveLength(1);
  });

  test("a flow's impact: what depends on it and what it uses, down the chain", () => {
    const arrows = graphCalls(data);
    expect([...reached(arrows, 'b', 'usedBy')].sort()).toEqual(['a', 'd']);
    expect([...reached(arrows, 'd', 'uses')].sort()).toEqual(['a', 'b', 'c', 'gone']);
    expect(reached(arrows, 'c', 'uses').size).toBe(0);
  });
});
