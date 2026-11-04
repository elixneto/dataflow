import vm from 'node:vm';
import { toError, type EvaluateExpression } from '@dataflow/core';

/** the longest an expression may take: an endless loop becomes the envelope's error, it does not hang the server */
const TIMEOUT_MS = 1000;

/**
 * Evaluates an expression in a new, empty node:vm context: only the envelope's variables are visible ($PARAMETERS,
 * $SECRETS, $VARIABLES, $FLOW_CURRENT_RUN and the DATA keys). No require, process, network or disk.
 */
export const evaluate: EvaluateExpression = (expression, variables) => {
  try {
    return vm.runInNewContext(`(${expression}\n)`, { ...variables }, { timeout: TIMEOUT_MS });
  } catch (e) {
    const original = toError(e);
    const error = new Error(`Expression "${expression}": ${original.message}`);
    // keeps the original type (ReferenceError, TypeError...)
    error.name = original.name;
    throw error;
  }
};
