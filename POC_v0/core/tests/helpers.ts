import vm from 'node:vm';
import type {ExecutableWorkflow} from '../src/index';

/** Evaluates expressions the way the runner does (node:vm), with a short timeout. */
export const evaluate = (expr: string, vars: Record<string, unknown>) => vm.runInNewContext(`(${expr})`, {...vars}, {timeout: 200});

/** Start → Mapper (a parameter with startedAt and a fixed text) → End. Tests that change it work on a structuredClone. */
export const mapperFlow: ExecutableWorkflow = {
  project: 'Test', workflow: 'Concatenate',
  parameters: [{name: 'prefix', type: 'text', default: 'IMP'}],
  nodes: [
    {id: 'start', type: 'start', label: 'Start', config: {}},
    {id: 'm', type: 'mapper', label: 'Mapper', outputKey: 'code', config: {fields: [
      {target: 'value', value: '`${$PARAMETERS.prefix}-${$WORKFLOW_CURRENT_RUN.startedAt}`', expression: true},
      {target: 'fixed', value: 'plain text', expression: false},
    ]}},
    {id: 'end', type: 'end', label: 'End', config: {}},
  ],
  edges: [
    {source: 'start', sourcePort: 'out-0', target: 'm', targetPort: 'in-0'},
    {source: 'm', sourcePort: 'out-0', target: 'end', targetPort: 'in-0'},
  ],
};
