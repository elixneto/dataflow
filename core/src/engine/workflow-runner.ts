import {START} from '#engine/constants';
import {resolveParameters} from '#engine/workflow-parameters';
import {WorkflowExecution} from '#engine/workflow-execution';
import {findCycle} from '#validation/workflow-cycle';
import type {EnvelopeData} from '#types/envelope-data.type';
import type {ExecutableWorkflow} from '#types/executable-workflow.type';
import type {RunOptions} from '#types/run-options.type';
import type {RunRecord} from '#types/run-record.type';

/** Array: one envelope per item (envelope by envelope); object: the fields become DATA; any other value: DATA.input. */
function initialEnvelopes(input: unknown): EnvelopeData[] {
  const toData = (v: unknown): EnvelopeData =>
    v !== null && typeof v === 'object' && !Array.isArray(v) ? {...(v as EnvelopeData)} : {input: v};
  if (input === undefined) return [{}];
  return Array.isArray(input) ? input.map(toData) : [toData(input)];
}

/**
 * Runs the workflow envelope by envelope (see WorkflowExecution). Before starting, checks the parameters, cycles and the
 * input. Returns the record with start, end, counts, logs and samples per component.
 */
export async function workflowRunner(wf: ExecutableWorkflow, options: RunOptions): Promise<RunRecord> {
  const {parameters, missing} = resolveParameters(wf, options.parameterValues);
  const execution = new WorkflowExecution(wf, options, parameters);

  if (missing.length) return execution.finish('failed', `Required parameter without a value: ${missing.join(', ')}.`);

  const cycle = findCycle(wf.nodes.map(n => n.id), wf.edges);
  if (cycle) {
    const name = (id: string) => wf.nodes.find(n => n.id === id)?.label ?? id;
    return execution.finish('failed', `The flow has a cycle (infinite loop): ${cycle.map(name).join(' → ')}.`);
  }

  const startAcceptsInput = wf.nodes.find(n => n.type === START)?.config.acceptsInput === true;
  if (options.input !== undefined && !startAcceptsInput) {
    return execution.finish('failed', 'The Start of this workflow does not accept input. Check "Accepts input" on the Start or call it without a body.');
  }

  return execution.execute(initialEnvelopes(options.input));
}
