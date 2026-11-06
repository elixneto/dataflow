import {describe, expect, test} from 'bun:test';
import {COMPONENTS, componentSummary, flowRunner, flowScriptUses, invokerCode, scriptCodeOf, scriptFunctions} from '../../src/index';
import type {ExecutableFlow, ScriptArgument} from '../../src/index';
import {evaluate} from '../helpers';

describe('the functions a script exports', () => {
  test('their parameters in order: type as written, optional (?, a default, rest), destructured ones named by position', () => {
    const code = `import type { Item } from '@myproject/scripts/types';
// export function commented(x: number) {}
export async function upload(items: Item[], options?: { retries: number; onDone: (n: number) => void }, timeoutMs = 30_000) {}
export function sum(...values: number[]): number { return 0; }
export function pick<T extends { id: string }>({ id }: T, keys: Array<keyof T>): string { return id; }
export function none() {}
function hidden(a: string) {}
export const arrow = (a: number) => a;
export function over(a: string): void;
export function over(a: string, b?: number): void {}`;
    expect(scriptFunctions(code)).toEqual([
      {name: 'upload', params: [
        {name: 'items', type: 'Item[]', optional: false},
        {name: 'options', type: '{ retries: number; onDone: (n: number) => void }', optional: true},
        {name: 'timeoutMs', type: '', optional: true},
      ]},
      {name: 'sum', params: [{name: 'values', type: 'number[]', optional: true, rest: true}]},
      {name: 'pick', params: [{name: 'arg1', type: 'T', optional: false}, {name: 'keys', type: 'Array<keyof T>', optional: false}]},
      {name: 'none', params: []},
      {name: 'over', params: [{name: 'a', type: 'string', optional: false}, {name: 'b', type: 'number', optional: true}]},
    ]);
  });
});

describe('Script Invoker', () => {
  const edge = (source: string, target: string) => ({source, sourcePort: 'out-0', target, targetPort: 'in-0'});
  const args = (...list: ScriptArgument[]) => list;
  const flow = (config: Record<string, unknown>, override = false): ExecutableFlow => ({
    project: 'Test', flow: 'Calls a script', parameters: [],
    nodes: [
      {id: 'start', type: 'start', label: 'Start', config: {}},
      {id: 'g', type: 'datagrid', label: 'Numbers', config: {columns: [{name: 'n', type: 'number'}], rows: [['1'], ['2']]}},
      {id: 's', type: 'script', label: 'Add', config, ...(override ? {override: true} : {})},
      {id: 'end', type: 'end', label: 'End', config: {}},
    ],
    edges: [edge('start', 'g'), edge('g', 's'), edge('s', 'end')],
  });
  // the runner's prepareScript stands in for the server's: the code it gets is the call; `add` is the script's function
  const runner = (fn: (...a: unknown[]) => unknown) => {
    const prepared: string[] = [];
    const prepareScript = async (code: string) => {
      prepared.push(code);
      return async (input: unknown) => fn(...(input as unknown[]));
    };
    return {prepared, prepareScript};
  };

  test('calls the function per envelope with its arguments in order (expressions, fixed values as their type), the result in the output key', async () => {
    const seen: unknown[][] = [];
    const {prepared, prepareScript} = runner((...a) => {
      seen.push(a);
      return (a[0] as number) * (a[1] as number);
    });
    const config = {
      function: 'math/ops#times',
      arguments: args(
        {name: 'n', type: 'number', value: '$n + 1', expression: true},
        {name: 'by', type: 'number', value: '10', expression: false},
        {name: 'label', type: 'string', value: '', expression: false},
        {name: 'flags', type: '{ debug: boolean }', value: '{"debug": true}', expression: false},
      ),
    };
    expect(COMPONENTS.script!.validate(config)).toEqual([]);
    const r = await flowRunner(flow(config), {mode: 'execution', id: 'si', evaluate, prepareScript});
    expect(r.status).toBe('completed');
    expect(prepared).toEqual([invokerCode('math/ops', 'times')]);
    expect(prepared[0]).toContain("import { times as __dataflowCalled } from '@myproject/scripts/math/ops';");
    // empty: undefined (its default applies)
    expect(seen).toEqual([[2, 10, undefined, {debug: true}], [3, 10, undefined, {debug: true}]]);
    expect(r.components.find(c => c.nodeId === 's')!.outputSample['out-0']).toEqual([{n: 1, result: 20}, {n: 2, result: 30}]);
  });

  test('with Override the result is the DATA; an exception is an error of the envelope', async () => {
    const config = {function: 'math/ops#twice', arguments: args({name: 'n', value: '$n', expression: true})};
    const {prepareScript} = runner(n => [{v: n}, {v: n}]);
    const r = await flowRunner(flow(config, true), {mode: 'execution', id: 'si2', evaluate, prepareScript});
    expect(r.components.find(c => c.nodeId === 's')!.outputSample['out-0']).toEqual([{v: 1}, {v: 1}, {v: 2}, {v: 2}]);
    const failing = runner(n => {
      if (n === 2) throw new Error('two is not allowed');
      return n;
    });
    const f = await flowRunner(flow({...config, onError: 'continue'}), {mode: 'execution', id: 'si3', evaluate, prepareScript: failing.prepareScript});
    const s = f.components.find(c => c.nodeId === 's')!;
    // Continue: the failed envelope goes on as it came
    expect(s.outputSample['out-0']).toEqual([{n: 1, result: 1}, {n: 2}]);
    expect(s.logs.some(l => l.level === 'error' && l.message.includes('two is not allowed'))).toBe(true);
  });

  test('no function chosen: a configuration issue; the code it runs names the script (the run takes it, its uses list it)', () => {
    expect(COMPONENTS.script!.validate({})).toEqual(['has no function selected.']);
    expect(scriptCodeOf('script', {})).toBeUndefined();
    expect(scriptCodeOf('script', {function: 'a/b#c'})).toBe(invokerCode('a/b', 'c'));
    expect(scriptCodeOf('typescript', {code: 'x'})).toBe('x');
    expect(scriptCodeOf('mapper', {})).toBeUndefined();
    const uses = flowScriptUses([{...flow({function: 'math/ops#times'}), id: 'f1'}]);
    expect(uses).toEqual([{from: 'f1', path: 'math/ops', nodeId: 's', nodeLabel: 'Add', how: 'import'}]);
    expect(componentSummary('script', {function: 'math/ops#times', arguments: args({name: 'n', value: '$n', expression: true}, {name: 'by', value: '', expression: false})}))
      .toEqual([{title: 'Function', lines: [{value: 'times (math/ops)', code: false}]}, {title: 'Arguments', lines: [{label: 'n', value: '$n', code: true}]}]);
  });
});
