import {expect, test} from 'bun:test';
import {flowRunner} from '../../src/index';
import type {ExecutableFlow} from '../../src/index';
import {evaluate} from '../helpers';

test('Router sends each envelope to the first true case or to the else', async () => {
  const withRouter: ExecutableFlow = {
    project: 'Test', flow: 'Router', parameters: [],
    nodes: [
      {id: 'start', type: 'start', label: 'Start', config: {acceptsInput: true}},
      {id: 'r', type: 'router', label: 'Router', config: {cases: [
        {label: 'SP', condition: '$state === "SP"'},
        {label: 'South', condition: '["PR", "SC", "RS"].includes($state)'},
      ]}},
      {id: 'end', type: 'end', label: 'End', config: {}},
    ],
    edges: [
      {source: 'start', sourcePort: 'out-0', target: 'r', targetPort: 'in-0'},
      {source: 'r', sourcePort: 'out-0', target: 'end', targetPort: 'in-0'},
      {source: 'r', sourcePort: 'out-1', target: 'end', targetPort: 'in-0'},
      // else (out-2) unconnected: drops without a warning
    ],
  };
  const input = [{state: 'SP'}, {state: 'RS'}, {state: 'BA'}, {state: 'SC'}, {state: 'SP'}];
  const r = await flowRunner(withRouter, {mode: 'execution', id: 'tr', evaluate, input});
  expect(r.status).toBe('completed');
  const router = r.components.find(c => c.nodeId === 'r')!;
  expect(router.status).toBe('completed');
  expect(router.outputs).toEqual({'out-0': 2, 'out-1': 2, 'out-2': 1});
  expect(r.components.find(c => c.nodeId === 'end')!.inputs['in-0']).toBe(4);
});
