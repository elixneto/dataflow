import {dataVariables, mergeSamples, type AvailableVariable, type RunRecord} from '@dataflow/core';

/**
 * Variables seen going out of each node's ports, kept per flow: node id → output port → variables (path, type, example).
 * Each run, successful or not, updates the ports that produced samples; the others keep what they had.
 */
export type KnownVariables = Record<string, Record<string, AvailableVariable[]>>;

const key = (flowId: string) => `dataflow-variables-${flowId}`;

export function updateKnownVariables(previous: KnownVariables, record: RunRecord): KnownVariables {
  const next = {...previous};
  for (const component of record.components) {
    for (const [port, samples] of Object.entries(component.outputSample)) {
      if (samples.length) next[component.nodeId] = {...next[component.nodeId], [port]: dataVariables(mergeSamples(samples))};
    }
  }
  return next;
}

export function loadKnownVariables(flowId: string): KnownVariables {
  try {
    localStorage.removeItem(`dataflow-last-run-${flowId}`); // replaced by this key
    const stored = localStorage.getItem(key(flowId));
    return stored ? JSON.parse(stored) as KnownVariables : {};
  } catch {
    return {};
  }
}

export function saveKnownVariables(flowId: string, known: KnownVariables) {
  try {
    localStorage.setItem(key(flowId), JSON.stringify(known));
  } catch {
    // no storage (or full): the suggestions only last until reload
  }
}
