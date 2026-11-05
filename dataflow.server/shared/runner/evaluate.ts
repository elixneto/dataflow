import vm from 'node:vm';
import { missingFields, toError, type EvaluateExpression } from '@dataflow/core';

/** the longest an expression may take: an endless loop becomes the envelope's error, it does not hang the server */
const TIMEOUT_MS = 1000;
/** compiled expressions kept per evaluator (a run's flows hold a bounded set of expression texts) */
const KEPT_SCRIPTS = 2000;
/** the global through which a call's arguments reach its compiled function */
const ARGUMENTS = '__dataflowArguments';
/** a variable the expression names: every envelope variable starts with $ */
const NAMED = /\$[\p{ID_Continue}$\u200C\u200D]+/gu;

/**
 * Runs once in a new context: makes the global names of the built-ins read-only (`Math = null` cannot reach the next
 * expression) and returns the function that readies the context for a call: it removes every global the previous call
 * left, hands over the call's arguments and sets the envelope's variables as globals (as a context per call had them,
 * so `globalThis['$' + name]` still reads a field). It lives inside the context because a global an expression creates
 * is not seen from outside it. The built-in objects themselves are not frozen: what an expression returns stays writable.
 */
const PREPARE = `(() => {
  const keep = new Set(Object.getOwnPropertyNames(globalThis));
  for (const name of keep) {
    const own = Object.getOwnPropertyDescriptor(globalThis, name);
    if (own && own.configurable && 'value' in own) Object.defineProperty(globalThis, name, { ...own, writable: false, configurable: false });
  }
  return (args, variables) => {
    for (const name of Object.getOwnPropertyNames(globalThis)) if (!keep.has(name)) delete globalThis[name];
    globalThis.${ARGUMENTS} = args;
    for (const name in variables) globalThis[name] = variables[name];
  };
})()`;

type Compiled = { script: vm.Script; names: string[] };

/**
 * An evaluator for one run. Each expression is compiled once, as a function whose parameters are the variables it names
 * ($PARAMETERS, $SECRETS, $VARIABLES, $FLOW_CURRENT_RUN and the DATA keys; one the envelope lacks is undefined), and
 * called in one node:vm context of its own: no require, process, network or disk. Being parameters, the variables
 * belong to the call: a function the expression returns keeps seeing its own envelope. tests/unit/runner/
 * evaluate-compat.test.ts holds it to what a new context per call (`evaluate`) gives, which cost a context's allocation
 * every time: about 0.1 ms and 100 KB of garbage per expression.
 */
export function createEvaluate(): EvaluateExpression {
  const context = vm.createContext({});
  const prepare = vm.runInContext(PREPARE, context) as (args: unknown[], variables: Record<string, unknown>) => void;
  const scripts = new Map<string, Compiled>();
  const compiled = (expression: string): Compiled => {
    let entry = scripts.get(expression);
    if (!entry) {
      if (scripts.size >= KEPT_SCRIPTS) {
        scripts.clear();
      }

      const names = [...new Set(expression.match(NAMED) ?? [])];
      const script = new vm.Script(`(function (${names.join(', ')}) {\nreturn (${expression}\n);\n}).apply(undefined, globalThis.${ARGUMENTS})`);
      entry = { script, names };
      scripts.set(expression, entry);
    }

    return entry;
  };

  return (expression, variables) => {
    try {
      const { script, names } = compiled(expression);
      prepare(
        names.map(name => variables[name]),
        variables,
      );
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
