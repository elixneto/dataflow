import vm from 'node:vm';
import {toError, type PrepareScript} from '@dataflow/core';

/** Time of the synchronous part of a call (an infinite loop becomes an error, it does not hang the runner). */
const SYNC_TIMEOUT_MS = 5_000;
/** Total time of a process call, counting what it awaits (fetch etc.). */
const CALL_TIMEOUT_MS = Number(process.env.RUNNER_SCRIPT_TIMEOUT_MS ?? 30_000);

const transpiler = new Bun.Transpiler({loader: 'ts', deadCodeElimination: false, treeShaking: false, trimUnusedImports: false});

/**
 * TypeScript component: strips the types (Bun.Transpiler) and runs the code in a new node:vm context, with the
 * run's globals and the minimum to call APIs (fetch, URL, setTimeout...). No require, process, disk.
 * node:vm separates the scope, but it is not a security boundary: the code belongs to whoever has access to the editor (run the runner only in a trusted environment).
 */
export const prepareScript: PrepareScript = async (code, globals) => {
  let js: string;
  try {
    js = transpiler.transformSync(code);
  } catch (e) {
    throw new SyntaxError(`The code does not compile: ${toError(e).message}`);
  }
  const context = vm.createContext({
    $PARAMETERS: globals.parameters,
    $SECRETS: globals.secrets,
    $WORKFLOW_CURRENT_RUN: globals.run,
    log: (...parts: unknown[]) => globals.log(parts.map(p => (typeof p === 'string' ? p : JSON.stringify(p))).join(' ')),
    console: {log: (...parts: unknown[]) => globals.log(parts.map(p => (typeof p === 'string' ? p : JSON.stringify(p))).join(' '))},
    fetch, Headers, Request, Response, URL, URLSearchParams, AbortController, FormData, Blob,
    TextEncoder, TextDecoder, atob, btoa, structuredClone, setTimeout, clearTimeout,
    crypto: {randomUUID: () => crypto.randomUUID()},
  });
  try {
    vm.runInContext(js, context, {timeout: SYNC_TIMEOUT_MS, filename: 'component.ts'});
  } catch (e) {
    throw toError(e);
  }
  if (vm.runInContext('typeof process', context) !== 'function') throw new Error('The code has no process function.');

  return async input => {
    context.__input = input;
    const promise = vm.runInContext('process(__input)', context, {timeout: SYNC_TIMEOUT_MS}) as Promise<unknown>;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const overrun = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`process exceeded ${CALL_TIMEOUT_MS / 1000} s.`)), CALL_TIMEOUT_MS);
    });
    try {
      return await Promise.race([promise, overrun]);
    } finally {
      clearTimeout(timer);
    }
  };
};
