import { createContext, useContext } from 'react';
import type { AvailableVariable, EnvelopeData, KnownVariables, RunRecord } from '@dataflow/core';

/** what an expression field suggests at a component (the core's inputVariables + systemVariables) */
export type ExpressionVariables = {
  /** the variables at the node: what reached it in the runs so far (only at `port`, if given) and the system ones */
  of: (nodeId: string, port?: string) => AvailableVariable[];
  /** something reached the node in a run: a variable outside the list then deserves a warning */
  seen: (nodeId: string, port?: string) => boolean;
};

export const ExpressionVariablesContext = createContext<ExpressionVariables>({ of: () => [], seen: () => false });

export const useExpressionVariables = () => useContext(ExpressionVariablesContext);

/*
 * What the runs saw is kept in this browser tab under versioned keys. v2: what was kept before the engine hid the
 * credentials in response headers (a session cookie) and the tokens echoed in responses is dropped, never read.
 */
const STORAGE_VERSION = 'v2';
const OLD_KEYS = /^dataflow\.(knownVariables|inputSamples)(\.v1)?:/;

/** removes what earlier versions kept (it may hold a credential a response carried) */
export function dropOldRunCaches(storage: Pick<Storage, 'length' | 'key' | 'removeItem'> | undefined = globalThis.sessionStorage) {
  try {
    if (!storage) {
      return;
    }

    const old: string[] = [];
    for (let i = 0; i < storage.length; i++) {
      const name = storage.key(i);
      if (name && OLD_KEYS.test(name)) {
        old.push(name);
      }
    }

    old.forEach(name => storage.removeItem(name));
  } catch {
    // no storage: nothing kept
  }
}

dropOldRunCaches();

const key = (flowId: string) => `dataflow.knownVariables.${STORAGE_VERSION}:${flowId}`;

/** what the runs of this flow saw, kept in this browser tab (suggestions come back after a reload) */
export function readKnownVariables(flowId: string): KnownVariables {
  try {
    return JSON.parse(sessionStorage.getItem(key(flowId)) ?? '{}') as KnownVariables;
  } catch {
    return {};
  }
}

export function rememberKnownVariables(flowId: string, known: KnownVariables) {
  try {
    sessionStorage.setItem(key(flowId), JSON.stringify(known));
  } catch {
    // no storage: the suggestions last until the page reloads
  }
}

const samplesKey = (flowId: string) => `dataflow.inputSamples.${STORAGE_VERSION}:${flowId}`;

/** the envelopes the last runs saw reaching each component (their DATA): a TypeScript component's `Data` comes from them */
export type InputSamples = Record<string, EnvelopeData[]>;

/** how many envelopes of each component are kept (enough for the shape) */
const KEPT_SAMPLES = 20;

/** the samples after a run: each component that received envelopes takes those; the others keep what they had */
export function inputSamplesAfter(previous: InputSamples, record: RunRecord): InputSamples {
  const next = { ...previous };
  for (const c of record.components) {
    if (c.inputSample.length) {
      next[c.nodeId] = c.inputSample.slice(0, KEPT_SAMPLES);
    }
  }

  return next;
}

export function readInputSamples(flowId: string): InputSamples {
  try {
    return JSON.parse(sessionStorage.getItem(samplesKey(flowId)) ?? '{}') as InputSamples;
  } catch {
    return {};
  }
}

export function rememberInputSamples(flowId: string, samples: InputSamples) {
  try {
    sessionStorage.setItem(samplesKey(flowId), JSON.stringify(samples));
  } catch {
    // no storage: the types last until the page reloads
  }
}

/** how many suggestions the list shows at once */
const MAX_SUGGESTIONS = 50;

/** the `$...` being typed right before the cursor, if any */
export function tokenAt(text: string, cursor: number): { start: number; text: string } | null {
  const match = /\$[\w.]*$/.exec(text.slice(0, cursor));
  return match ? { start: cursor - match[0].length, text: match[0] } : null;
}

/** the suggestions for what is being typed: the paths that start with it (ignoring case), not the one already typed */
export const suggestionsFor = (variables: AvailableVariable[], token: string) =>
  variables.filter(v => v.path.toLowerCase().startsWith(token.toLowerCase()) && v.path !== token).slice(0, MAX_SUGGESTIONS);
