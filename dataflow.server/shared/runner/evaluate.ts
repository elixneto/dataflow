import vm from 'node:vm';
import { expressionScope, missingFields, toError, type EvaluateExpression } from '@dataflow/core';

/** the longest an expression may take: an endless loop becomes the envelope's error, it does not hang the server */
const TIMEOUT_MS = 1000;

/**
 * Evaluates an expression in a new, empty node:vm context: only the envelope's variables are visible ($PARAMETERS,
 * $SECRETS, $VARIABLES, $FLOW_CURRENT_RUN and the DATA keys; a `$name` the envelope lacks is undefined). No require,
 * process, network or disk.
 */
export const evaluate: EvaluateExpression = (expression, variables) => {
  try {
    return vm.runInNewContext(`(${expression}\n)`, expressionScope(expression, variables), { timeout: TIMEOUT_MS });
  } catch (e) {
    const original = toError(e);
    // a field this envelope lacks is undefined: when reading into it fails, say which ones are missing
    const missing = missingFields(expression, variables);
    const hint = missing.length ? ` (not in this envelope: ${missing.join(', ')})` : '';
    const error = new Error(`Expression "${expression}": ${original.message}${hint}`);
    // keeps the original type (ReferenceError, TypeError...)
    error.name = original.name;
    throw error;
  }
};
