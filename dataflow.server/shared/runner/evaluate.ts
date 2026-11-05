import vm from 'node:vm';
import { expressionScope, missingFields, toError, type EvaluateExpression } from '@dataflow/core';

/** the longest an expression may take: an endless loop becomes the envelope's error, it does not hang the server */
const TIMEOUT_MS = 1000;
/** compiled expressions kept per evaluator (a run's flows hold a bounded set of expression texts and field names) */
const KEPT_SCRIPTS = 2000;
/** the global through which a call's arguments reach its compiled function */
const ARGUMENTS = '__dataflowArguments';
/** a variable that can be a function parameter: every envelope variable starts with $ (a field like `$first name` cannot be read anyway) */
const PARAMETER = /^\$[\p{ID_Continue}$\u200C\u200D]*$/u;

/**
 * Runs once in a new context: makes the global names of the built-ins read-only (`Math = null` cannot reach the next
 * expression) and returns the function that readies the context for a call: it removes every global the previous call
 * created and hands over the call's arguments. It lives inside the context because a global an expression creates is
 * not seen from outside it. The built-in objects themselves are not frozen: an object an expression returns must stay
 * writable for whoever gets it.
 */
const PREPARE = `(() => {
  const keep = new Set(Object.getOwnPropertyNames(globalThis));
  for (const name of keep) {
    const own = Object.getOwnPropertyDescriptor(globalThis, name);
    if (own && own.configurable && 'value' in own) Object.defineProperty(globalThis, name, { ...own, writable: false, configurable: false });
  }
  return args => {
    for (const name of Object.getOwnPropertyNames(globalThis)) if (!keep.has(name)) delete globalThis[name];
    globalThis.${ARGUMENTS} = args;
  };
})()`;

/**
 * An evaluator for one run. Each expression is compiled once, as a function whose parameters are the envelope's
 * variables ($PARAMETERS, $SECRETS, $VARIABLES, $FLOW_CURRENT_RUN and the DATA keys; a `$name` the envelope lacks is
 * undefined), and called in one node:vm context of its own: no require, process, network or disk. Being parameters,
 * the variables belong to the call: a function the expression returns keeps seeing its own envelope. A new context per
 * call (`evaluate`) cost a context's allocation every time: about 0.1 ms and 100 KB of garbage per expression.
 */
export function createEvaluate(): EvaluateExpression {
  const context = vm.createContext({});
  const prepare = vm.runInContext(PREPARE, context) as (args: unknown[]) => void;
  const scripts = new Map<string, vm.Script>();
  const compiled = (expression: string, names: string[]) => {
    const key = `${names.join(',')}\u0000${expression}`;
    let script = scripts.get(key);
    if (!script) {
      if (scripts.size >= KEPT_SCRIPTS) {
        scripts.clear();
      }

      script = new vm.Script(`(function (${names.join(', ')}) {\nreturn (${expression}\n);\n}).apply(undefined, globalThis.${ARGUMENTS})`);
      scripts.set(key, script);
    }

    return script;
  };

  return (expression, variables) => {
    try {
      const scope = expressionScope(expression, variables);
      const names = Object.keys(scope)
        .filter(name => PARAMETER.test(name))
        .sort();
      const script = compiled(expression, names);
      prepare(names.map(name => scope[name]));
      return script.runInContext(context, { timeout: TIMEOUT_MS });
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
}

/** Evaluates one expression on its own, in a new empty context (a run uses `createEvaluate`: one context for the run). */
export const evaluate: EvaluateExpression = (expression, variables) => createEvaluate()(expression, variables);
