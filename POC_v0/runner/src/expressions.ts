import vm from 'node:vm';
import {toError, type EvaluateExpression} from '@dataflow/core';

/** Maximum time of an expression: an infinite loop becomes an error of the row, it does not hang the runner. */
const TIMEOUT_MS = 1000;

/**
 * Evaluates an expression in a new, empty node:vm context: only the envelope's variables are visible
 * ($WORKFLOW_CURRENT_RUN, $PARAMETERS, $SECRETS and the DATA keys). No require, process, network or disk.
 */
export const evaluate: EvaluateExpression = (expression, variables) => {
  try {
    return vm.runInNewContext(`(${expression}\n)`, {...variables}, {timeout: TIMEOUT_MS});
  } catch (e) {
    const original = toError(e);
    const error = new Error(`Expression "${expression}": ${original.message}`);
    // keeps the original type (ReferenceError, TypeError...): goes to DATA.errors[].error
    error.name = original.name;
    throw error;
  }
};
