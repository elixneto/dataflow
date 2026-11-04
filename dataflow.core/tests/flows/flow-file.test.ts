import {expect, test} from 'bun:test';
import {flowFileName, flowFromYaml, flowToYaml, toExecutableFlow, type FlowFile} from '../../src/index';

const FLOW: FlowFile = {
  version: 1,
  id: 'f1',
  name: 'Load orders',
  nodes: [
    {id: 'start', type: 'start', position: {x: 0, y: 0}, config: {acceptsInput: true, parameters: [{name: 'since', type: 'number', default: '10'}]}},
    {id: 'sql', type: 'sqlserver', label: 'Orders', position: {x: 160.4, y: 0}, config: {connection: 'erp', sql: 'SELECT id\nFROM Orders\nWHERE id > @since', parameters: [{name: 'since', value: '$PARAMETERS.since', expression: true}]}, notes: 'the ERP'},
    {id: 'map', type: 'mapper', position: {x: 320, y: 0}, config: {fields: [{target: 'total', value: '$a', expression: true}], onError: 'divert'}, outputKey: 'x', disabled: true, pinned: true},
    {id: 'log', type: 'log', position: {x: 480, y: 80}, config: {message: '$error'}},
    {id: 'end', type: 'end', position: {x: 640, y: 0}, config: {}},
  ],
  edges: [
    {source: 'start', sourcePort: 'out-0', target: 'sql', targetPort: 'in-0'},
    {source: 'sql', sourcePort: 'out-0', target: 'map', targetPort: 'in-0'},
    {source: 'map', sourcePort: 'out-0', target: 'end', targetPort: 'in-0'},
    {source: 'map', sourcePort: 'error', target: 'log', targetPort: 'in-0'},
  ],
  groups: [{id: 'g1', title: 'Read', color: '#3b82f6', position: {x: -32, y: -48}, size: {width: 640, height: 352}}],
};

test('a flow goes to YAML and comes back the same (positions rounded); multi-line text as a literal block', () => {
  const text = flowToYaml(FLOW);
  expect(text).toContain('version: 1');
  expect(text).toContain('sql: |-\n');
  const back = flowFromYaml(text);
  expect(back.ok).toBe(true);
  if (back.ok) {
    expect(back.value).toEqual({...FLOW, nodes: FLOW.nodes.map(n => (n.id === 'sql' ? {...n, position: {x: 160, y: 0}} : n))});
    expect(flowToYaml(back.value)).toBe(text);
  }
});

test('no secret value goes in the file: a connection is an id, a secret a name', () => {
  const text = flowToYaml(FLOW);
  expect(text).toContain('connection: erp');
  expect(text).not.toContain('password');
});

test('a broken file says what is wrong and gives nothing', () => {
  expect(flowFromYaml('nodes: [')).toMatchObject({ok: false});
  expect(flowFromYaml('- a')).toEqual({ok: false, errors: ['Not a flow file.']});
  expect(flowFromYaml('version: 9\nname: x\nnodes:\n  - {id: a, type: mapper, position: {x: 0, y: 0}}\nedges:\n  - {source: a, sourcePort: out-0, target: zz, targetPort: in-0}\n')).toEqual({
    ok: false,
    errors: [
      'Unknown file version 9 (this app reads 1).',
      'The flow needs exactly one Start (it has 0).',
      'The flow needs exactly one End (it has 0).',
      'Edge 1 connects a node that is not in the flow.',
    ],
  });
});

test('the file name comes from the flow name; the runner gets the flow without layout, the parameters from the Start', () => {
  expect(flowFileName('Carga de Pedidos (ERP)!')).toBe('carga-de-pedidos-erp.yaml');
  expect(flowFileName('***')).toBe('flow.yaml');
  const executable = toExecutableFlow(FLOW, 'Sales');
  expect(executable.parameters).toEqual([{name: 'since', type: 'number', default: '10'}]);
  expect(executable.nodes.find(n => n.id === 'sql')).toEqual({id: 'sql', type: 'sqlserver', label: 'Orders', config: FLOW.nodes[1]!.config});
  expect(executable).toMatchObject({id: 'f1', project: 'Sales', flow: 'Load orders', edges: FLOW.edges});
});

test('the server checks the JSON the editor saves with the same rules; the connection rules too', async () => {
  const {validateFlowFile, newFlowFile} = await import('../../src/index');
  expect(validateFlowFile(FLOW)).toEqual({ok: true, value: FLOW});
  expect(validateFlowFile(null)).toEqual({ok: false, errors: ['Not a flow file.']});
  const startToEnd = {...newFlowFile('x'), edges: [{source: 'start', sourcePort: 'out-0', target: 'end', targetPort: 'in-0'}]};
  const result = validateFlowFile(startToEnd);
  expect(result.ok).toBe(false);
  // a component with incomplete settings is still saved (a flow being built)
  expect(validateFlowFile({...newFlowFile('x'), nodes: [...newFlowFile('x').nodes, {id: 'f', type: 'filter', position: {x: 1, y: 1}, config: {}}]}).ok).toBe(true);
});

test('a new flow: its Start and its End, nothing between them', async () => {
  const {newFlowFile, validateFlowFile} = await import('../../src/index');
  const flow = newFlowFile('Orders', 'f9');
  expect(flow.nodes.map(n => n.type)).toEqual(['start', 'end']);
  expect(flow).toMatchObject({version: 1, id: 'f9', name: 'Orders', edges: []});
  expect(validateFlowFile(flow).ok).toBe(true);
});
