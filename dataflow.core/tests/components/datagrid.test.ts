import {expect, test} from 'bun:test';
import {COMPONENTS, workflowRunner} from '../../src/index';
import type {ExecutableWorkflow} from '../../src/index';
import {evaluate} from '../helpers';

test('data grid yields one envelope per row, with the columns converted by type', async () => {
  const grid: ExecutableWorkflow = {
    project: 'Test', workflow: 'Data Grid', parameters: [],
    nodes: [
      {id: 'start', type: 'start', label: 'Start', config: {}},
      {id: 'g', type: 'datagrid', label: 'Data Grid', config: {
        columns: [{name: 'code', type: 'text'}, {name: 'weight', type: 'number'}, {name: 'active', type: 'boolean'}],
        rows: [['A1', '1,5', 'yes'], ['B2', '', 'false']],
      }},
      {id: 'end', type: 'end', label: 'End', config: {}},
    ],
    edges: [
      {source: 'start', sourcePort: 'out-0', target: 'g', targetPort: 'in-0'},
      {source: 'g', sourcePort: 'out-0', target: 'end', targetPort: 'in-0'},
    ],
  };
  const r = await workflowRunner(grid, {mode: 'execution', id: 'grid', evaluate});
  expect(r.status).toBe('completed');
  expect(r.components.find(c => c.nodeId === 'g')!.outputSample['out-0']).toEqual([
    {code: 'A1', weight: 1.5, active: true},
    {code: 'B2', weight: null, active: false},
  ]);
});

test('data grid flags a cell that does not convert and a column without a name', () => {
  const config = {columns: [{name: 'n', type: 'number'}, {name: '', type: 'text'}], rows: [['abc', 'x']]};
  const issues = COMPONENTS.datagrid.validate(config);
  expect(issues.some(p => p.includes('"abc" is not a number'))).toBe(true);
  expect(issues.some(p => p.startsWith('column 2'))).toBe(true);
});
