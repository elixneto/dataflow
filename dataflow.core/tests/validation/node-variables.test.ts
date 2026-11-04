import {expect, test} from 'bun:test';
import {inputVariables, knownVariablesAfter, systemVariables, type RunRecord} from '../../src/index';

const record = (components: {nodeId: string; outputSample: RunRecord['components'][number]['outputSample']}[]): RunRecord => ({
  run: {id: 'r', mode: 'validation', project: 'p', flow: 'f', startedAt: ''},
  parameters: {},
  status: 'completed',
  end: '',
  durationMs: 1,
  components: components.map(c => ({...c, label: c.nodeId, type: 'mapper', status: 'completed', inputs: {}, outputs: {}, logs: [], inputSample: []})),
});

test("what reached a component in the runs so far: the DATA out of the ports feeding it (only that input, when asked)", () => {
  let known = knownVariablesAfter({}, record([
    {nodeId: 'http', outputSample: {'out-0': [{response: {status: 200, body: {data: [1]}}}]}},
    {nodeId: 'f', outputSample: {'out-0': [{id: 1, name: 'a'}], 'out-1': []}},
  ]));
  // a later run where the Filter sent nothing out of out-0 keeps what an earlier run saw there
  known = knownVariablesAfter(known, record([{nodeId: 'f', outputSample: {'out-0': [], 'out-1': [{id: 2, late: true}]}}]));
  const edges = [
    {source: 'http', sourcePort: 'out-0', target: 'split', targetPort: 'in-0'},
    {source: 'f', sourcePort: 'out-0', target: 'l', targetPort: 'in-0'},
    {source: 'f', sourcePort: 'out-1', target: 'l', targetPort: 'in-1'},
  ];
  expect(inputVariables(known, edges, 'split').variables.map(v => v.path)).toEqual(['$response', '$response.status', '$response.body', '$response.body.data']);
  expect(inputVariables(known, edges, 'split').variables[1]).toEqual({path: '$response.status', type: 'number', example: '200'});
  expect(inputVariables(known, edges, 'l').variables.map(v => v.path)).toEqual(['$id', '$name', '$late']);
  expect(inputVariables(known, edges, 'l', 'in-1').variables.map(v => v.path)).toEqual(['$id', '$late']);
  expect(inputVariables(known, edges, 'nobody')).toEqual({variables: [], seen: false});
  expect(inputVariables(known, edges, 'split').seen).toBe(true);
});

test('the system variables: parameters with their type, the project variables, secrets by name only, the run', () => {
  const vars = systemVariables([{name: 'since', type: 'number', default: '10'}], [{name: 'REGION', value: 'eu'}], ['API_TOKEN']);
  expect(vars).toContainEqual({path: '$PARAMETERS.since', type: 'number', example: '10'});
  expect(vars).toContainEqual({path: '$VARIABLES.REGION', type: 'string', example: '"eu"'});
  expect(vars).toContainEqual({path: '$SECRETS.API_TOKEN', type: 'secret'});
  expect(vars.some(v => v.path === '$FLOW_CURRENT_RUN.startedAt')).toBe(true);
});
