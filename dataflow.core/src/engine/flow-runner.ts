import { START } from '#engine/constants';
import { resolveParameters } from '#engine/flow-parameters';
import { FlowExecution } from '#engine/flow-execution';
import { findCycle } from '#validation/flow-cycle';
import { portConnectionIssues } from '#validation/port-connections';
import { errorEdgeIssues } from '#validation/ports';
import type { EnvelopeData } from '#types/envelope-data.type';
import type { ExecutableFlow } from '#types/executable-flow.type';
import type { RunOptions } from '#types/run-options.type';
import type { RunRecord } from '#types/run-record.type';

/** Array: one envelope per item (envelope by envelope); object: the fields become DATA; any other value: DATA.input. */
function initialEnvelopes(input: unknown): EnvelopeData[] {
  const toData = (v: unknown): EnvelopeData =>
    v !== null && typeof v === 'object' && !Array.isArray(v) ? { ...(v as EnvelopeData) } : { input: v };
  
  if (input === undefined) {
    return [{}];
  }

  return Array.isArray(input) ? input.map(toData) : [toData(input)];
}

/**
 * Runs the flow envelope by envelope (see FlowExecution). Before starting, checks the parameters, cycles, ports with
 * more than one edge and the input. Returns the record with start, end, counts, logs and samples per component.
 */
export async function flowRunner(wf: ExecutableFlow, options: RunOptions): Promise<RunRecord> {
  const { parameters, missing } = resolveParameters(wf, options.parameterValues);
  const execution = new FlowExecution(wf, options, parameters);

  if (missing.length) {
    return execution.finish('failed', `Required parameter without a value: ${missing.join(', ')}.`);
  }

  const name = (id: string) => wf.nodes.find(n => n.id === id)?.label ?? id;
  const cycle = findCycle(wf.nodes.map(n => n.id), wf.edges);
  if (cycle) {
    return execution.finish('failed', `The flow has a cycle (infinite loop): ${cycle.map(name).join(' → ')}.`);
  }

  // the connection rules (validation/ports.ts): one edge per port, but the Start's output and the End's input take
  // several; never Start straight to End. A flow from the API or the YAML may break them
  const nodeOf = (id: string) => wf.nodes.find(n => n.id === id);
  const crowded = [...portConnectionIssues(wf.edges, id => nodeOf(id)?.type), ...errorEdgeIssues(wf.edges, nodeOf)];
  if (crowded.length) {
    return execution.finish('failed', crowded.map(i => `"${name(i.nodeId)}" ${i.message}`).join(' '));
  }

  const startAcceptsInput = wf.nodes.find(n => n.type === START)?.config.acceptsInput === true;
  if (options.input !== undefined && !startAcceptsInput) {
    return execution.finish('failed', 'The Start of this flow does not accept input. Check "Accepts input" on the Start or call it without a body.');
  }

  return execution.execute(initialEnvelopes(options.input));
}
