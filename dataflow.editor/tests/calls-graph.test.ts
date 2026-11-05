import { describe, expect, test } from 'bun:test';
import type { FlowCall } from '@dataflow/core';
import { callsGraph, graphCalls, reached, scriptArrows } from '../src/pages/project-flows/calls-graph';

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
  scripts: ['lib/math', 'upload/types', 'unused'],
  scriptUses: [
    { from: 'a', path: 'upload/types', nodeId: 'start', nodeLabel: 'Start', how: 'type' as const },
    { from: 'a', path: 'upload/types', nodeId: 'ts', nodeLabel: 'Prices', how: 'import' as const },
    { from: 'lonely', path: 'lib/math', nodeId: 'ts', nodeLabel: 'Sum', how: 'import' as const },
    { from: 'lonely', path: 'lib/gone', nodeId: 'ts', nodeLabel: 'Sum', how: 'import' as const },
  ],
  scriptImports: [{ from: 'upload/types', to: 'lib/math' }],
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
    const graph = callsGraph(data, { scripts: false });
    expect(graph.flows.map(f => f.id).sort()).toEqual(['a', 'b', 'c', 'd', 'gone']);
    expect(graph.scripts).toEqual([]);
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

  test('with the scripts: an arrow per flow and script it uses (its components as the label), per script and script it imports', () => {
    expect(scriptArrows(data).map(a => [a.from, a.to, a.label, a.kind])).toEqual([
      ['a', 'script:upload/types', 'Start (input type), Prices', 'uses'],
      ['lonely', 'script:lib/math', 'Sum', 'uses'],
      ['lonely', 'script:lib/gone', 'Sum', 'uses'],
      ['script:upload/types', 'script:lib/math', '', 'imports'],
    ]);
  });

  test('with the scripts: a box per script used or imported (one not found marked), a flow using a script shows, the user left of it', () => {
    const graph = callsGraph(data);
    expect(graph.flows.map(f => f.id).sort()).toEqual(['a', 'b', 'c', 'd', 'gone', 'lonely']);
    expect(graph.scripts.map(s => [s.path, s.known]).sort()).toEqual([
      ['lib/gone', false],
      ['lib/math', true],
      ['upload/types', true],
    ]);
    const script = (path: string) => graph.scripts.find(s => s.path === path)!;
    expect(graph.flows.find(f => f.id === 'a')!.x).toBeLessThan(script('upload/types').x);
    expect(script('upload/types').x).toBeLessThan(script('lib/math').x);
  });

  test("a script's impact: the flows and scripts that use it, down the chain", () => {
    const arrows = callsGraph(data).calls;
    expect([...reached(arrows, 'script:lib/math', 'usedBy')].sort()).toEqual(['a', 'd', 'lonely', 'script:upload/types', 'b'].sort());
    expect([...reached(arrows, 'a', 'uses')].sort()).toEqual(['a', 'b', 'c', 'script:lib/math', 'script:upload/types'].filter(id => id !== 'a').sort());
  });
});
