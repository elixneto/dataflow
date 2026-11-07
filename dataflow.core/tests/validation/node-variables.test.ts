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
  // $DATA (the whole envelope's DATA) first, wherever something feeds the component
  expect(inputVariables(known, edges, 'split').variables.map(v => v.path)).toEqual(['$DATA', '$response', '$response.status', '$response.body', '$response.body.data']);
  expect(inputVariables(known, edges, 'split').variables[2]).toEqual({path: '$response.status', type: 'number', example: '200'});
  expect(inputVariables(known, edges, 'l').variables.map(v => v.path)).toEqual(['$DATA', '$id', '$name', '$late']);
  expect(inputVariables(known, edges, 'l', 'in-1').variables.map(v => v.path)).toEqual(['$DATA', '$id', '$late']);
  expect(inputVariables(known, edges, 'nobody')).toEqual({variables: [], seen: false});
  expect(inputVariables(known, edges, 'split').seen).toBe(true);
});

test('$DATA is the whole envelope, beside each of its keys; a key named DATA is still that key', async () => {
  const {envelopeVariables} = await import('../../src/envelope/expression-variables');
  const doc = {FLOW_CURRENT_RUN: {} as never, PARAMETERS: {}, DATA: {id: 1, tags: ['a']}};
  expect(envelopeVariables(doc).$DATA).toEqual({id: 1, tags: ['a']});
  expect(envelopeVariables(doc).$id).toBe(1);
  expect(envelopeVariables({...doc, DATA: {DATA: 'mine'}}).$DATA).toBe('mine');
});

test('the system variables: parameters with their type, the project variables, secrets by name only, the run', () => {
  const vars = systemVariables([{name: 'since', type: 'number', default: '10'}], [{name: 'REGION', value: 'eu'}], ['API_TOKEN']);
  expect(vars).toContainEqual({path: '$PARAMETERS.since', type: 'number', example: '10'});
  expect(vars).toContainEqual({path: '$VARIABLES.REGION', type: 'string', example: '"eu"'});
  expect(vars).toContainEqual({path: '$SECRETS.API_TOKEN', type: 'secret'});
  expect(vars.some(v => v.path === '$FLOW_CURRENT_RUN.startedAt')).toBe(true);
});

test('a group with nothing in it (no parameters, variables or secrets) is not suggested; the run always is', () => {
  const paths = systemVariables([], [], []).map(v => v.path);
  expect(paths.some(p => /^\$(PARAMETERS|VARIABLES|SECRETS)/.test(p))).toBe(false);
  expect(paths).toContain('$FLOW_CURRENT_RUN');
  expect(systemVariables([], [{name: 'REGION'}], []).map(v => v.path)).toEqual(expect.arrayContaining(['$VARIABLES', '$VARIABLES.REGION']));
});

test('a name an expression cannot read after a dot (a hyphen, a space) is suggested in brackets', async () => {
  const {dataVariables} = await import('../../src/index');
  const vars = systemVariables([], [{name: 'engage-base-url', value: 'x'}, {name: "it's", value: 'y'}], ['MY-KEY']);
  expect(vars.map(v => v.path)).toEqual(expect.arrayContaining(["$VARIABLES['engage-base-url']", "$VARIABLES['it\\'s']", "$SECRETS['MY-KEY']"]));
  expect(dataVariables({response: {headers: {'content-type': 'json', etag: '1'}}}).map(v => v.path))
    .toEqual(['$response', '$response.headers', "$response.headers['content-type']", '$response.headers.etag']);
  // what it suggests runs as written
  expect(new Function('$VARIABLES', `return ${vars.find(v => v.path.includes('engage'))!.path}`)({'engage-base-url': 'ok'})).toBe('ok');
});
