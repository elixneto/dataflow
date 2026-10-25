import {expect, test} from 'bun:test';
import {portConnectionIssues, workflowRunner} from '../../src/index';
import type {ExecutableWorkflow} from '../../src/index';
import {evaluate} from '../helpers';

const edge = (source: string, sourcePort: string, target: string, targetPort: string) => ({source, sourcePort, target, targetPort});
const isEnd = (id: string) => id === 'end';

test('each port takes one edge, except the End input', () => {
  expect(portConnectionIssues([edge('start', 'out-0', 'a', 'in-0'), edge('a', 'out-0', 'end', 'in-0'), edge('b', 'out-0', 'end', 'in-0')], isEnd)).toEqual([]);
  expect(portConnectionIssues([
    edge('start', 'out-0', 'a', 'in-0'), edge('start', 'out-0', 'end', 'in-0'),
    edge('a', 'out-0', 'agg', 'in-0'), edge('b', 'out-0', 'agg', 'in-0'), edge('a', 'error', 'log', 'in-0'), edge('a', 'error', 'end', 'in-0'),
  ], isEnd)).toEqual([
    {nodeId: 'start', message: 'has output 1 with 2 connections: each output goes to one input (use a Copy to send to several).'},
    {nodeId: 'a', message: 'has output "error" with 2 connections: each output goes to one input (use a Copy to send to several).'},
    {nodeId: 'agg', message: 'has input 1 with 2 connections: merge them with a Union first.'},
  ]);
});

test('a run refuses a flow with two edges on one input', async () => {
  const wf: ExecutableWorkflow = {
    project: 'Test', workflow: 'Crowded', parameters: [],
    nodes: [
      {id: 'start', type: 'start', label: 'Start', config: {}},
      {id: 'copy', type: 'copy', label: 'Copy', config: {outputCount: 2}},
      {id: 'limit', type: 'limit', label: 'Limit', config: {count: 1}},
      {id: 'end', type: 'end', label: 'End', config: {}},
    ],
    edges: [
      edge('start', 'out-0', 'copy', 'in-0'),
      edge('copy', 'out-0', 'limit', 'in-0'), edge('copy', 'out-1', 'limit', 'in-0'),
      edge('limit', 'out-0', 'end', 'in-0'),
    ],
  };
  const r = await workflowRunner(wf, {mode: 'execution', id: 'crowded', evaluate});
  expect(r.status).toBe('failed');
  expect(r.error).toBe('"Limit" has input 1 with 2 connections: merge them with a Union first.');
});
