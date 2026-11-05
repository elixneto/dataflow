import vm from 'node:vm';
import { SCRIPT_IMPORT_PREFIX, toError, type PrepareScript } from '@dataflow/core';

/*
 * The TypeScript component, in the worker (as in the PoC, POC_v0/runner/src/scripts.ts): its code and the project
 * scripts it imports (`@myproject/scripts/<path>`, from the run's snapshot) become one bundle (Bun.build, types
 * stripped: a type error does not stop it, a syntax error or an unknown import does), run in a new node:vm context
 * with the run's globals ($PARAMETERS, $SECRETS, $VARIABLES, $FLOW_CURRENT_RUN, log) and the minimum to call APIs
 * (fetch, URL, timers...). No require, process, Bun or disk. node:vm separates the scope but is not a security
 * boundary: the code is the project's, and each run has a worker process of its own.
 */

/** the synchronous part of a call: an endless loop becomes the envelope's error, it does not hang the worker */
const SYNC_TIMEOUT_MS = Number(process.env.SCRIPT_SYNC_TIMEOUT_MS ?? 5_000);
/** a whole call of process, what it awaits included (an HTTP call...) */
const CALL_TIMEOUT_MS = Number(process.env.SCRIPT_TIMEOUT_MS ?? 30_000);

/** where the component's process ends up for the caller, inside the bundle's context */
const EXPORTED = '__dataflowProcess';

/** a response with its body already read: reading it is part of the call (Waiting), not of the script's work */
const bodyRead = async (response: Response) =>
  new Response(await response.arrayBuffer(), { status: response.status, statusText: response.statusText, headers: response.headers });

const text = (parts: unknown[]) => parts.map(p => (typeof p === 'string' ? p : JSON.stringify(p))).join(' ');

/** the component's code and the scripts it imports as one script for node:vm; throws what does not compile */
export async function bundleScript(code: string, scripts: Record<string, string>): Promise<string> {
  // the component's code is a module that exports its process (an export keeps it an ES module, whatever it uses),
  // and a small entry hands it to the caller
  if (!/\bfunction\s+process\s*\(/.test(code)) {
    throw new Error('The code has no process function.');
  }

  const component = `${code}\n;export { process as ${EXPORTED} };\n`;
  const entry = `import { ${EXPORTED} } from 'dataflow:code';\nglobalThis.${EXPORTED} = ${EXPORTED};\n`;
  let result: Awaited<ReturnType<typeof Bun.build>>;
  try {
    result = await Bun.build({
      entrypoints: ['dataflow:component'],
      target: 'browser',
      format: 'iife',
      minify: false,
      throw: false,
      plugins: [
        {
          name: 'project-scripts',
          setup(build) {
            build.onResolve({ filter: /.*/ }, args => {
              if (args.path === 'dataflow:component') {
                return { path: 'entry.ts', namespace: 'dataflow' };
              }

              if (args.path === 'dataflow:code') {
                return { path: 'component.ts', namespace: 'dataflow' };
              }

              if (args.path.startsWith(SCRIPT_IMPORT_PREFIX)) {
                const path = args.path.slice(SCRIPT_IMPORT_PREFIX.length);
                if (!(path in scripts)) {
                  throw new Error(`The script "${args.path}" does not exist in this project.`);
                }

                return { path: `scripts/${path}.ts`, namespace: 'dataflow' };
              }

              throw new Error(`"${args.path}" cannot be imported: only the project's scripts (${SCRIPT_IMPORT_PREFIX}<path>).`);
            });
            build.onLoad({ filter: /.*/, namespace: 'dataflow' }, args => ({
              contents: args.path === 'entry.ts' ? entry : args.path === 'component.ts' ? component : scripts[args.path.slice('scripts/'.length, -'.ts'.length)]!,
              loader: 'ts',
            }));
          },
        },
      ],
    });
  } catch (e) {
    throw new SyntaxError(`The code does not compile: ${toError(e).message}`);
  }

  if (!result.success || !result.outputs[0]) {
    const messages = result.logs
      .filter(log => log.level === 'error')
      .map(log => {
        const where = log.position ? ` (${log.position.file.replace(/^dataflow:/, '').replace(/^scripts\//, SCRIPT_IMPORT_PREFIX)} line ${log.position.line})` : '';
        return `${log.message}${where}`;
      });
    throw new SyntaxError(`The code does not compile: ${messages.join('; ') || 'unknown error'}`);
  }

  return result.outputs[0].text();
}

/** Prepares a TypeScript component's process with the project's scripts it may import (`scripts`: {path: code}). */
/** bundles already made in this worker, by the component's code and its scripts' hashes: the latest ones */
const bundles = new Map<string, string>();
const KEPT_BUNDLES = 50;

/** the bundle of a component, made once per code and scripts (`hashes`: {path: hash}; none: not kept) */
async function cachedBundle(code: string, scripts: Record<string, string>, hashes: Record<string, string>): Promise<string> {
  if (Object.keys(scripts).length > 0 && Object.keys(hashes).length === 0) {
    return bundleScript(code, scripts);
  }

  const key = new Bun.CryptoHasher('sha256')
    .update(code)
    .update(JSON.stringify(Object.entries(hashes).sort(([a], [b]) => a.localeCompare(b))))
    .digest('hex');
  const known = bundles.get(key);
  if (known !== undefined) {
    bundles.delete(key);
    bundles.set(key, known);
    return known;
  }

  const js = await bundleScript(code, scripts);
  bundles.set(key, js);
  if (bundles.size > KEPT_BUNDLES) {
    bundles.delete(bundles.keys().next().value!);
  }

  return js;
}

/**
 * Prepares a TypeScript component's process with the scripts it may import (`scripts`: {path: code}; `hashes`:
 * {path: hash}, what makes the bundle reusable by the next runs of this worker).
 */
export const prepareScript = async (code: string, globals: Parameters<PrepareScript>[1], scripts: Record<string, string> = {}, hashes: Record<string, string> = {}) => {
  const js = await cachedBundle(code, scripts, hashes);
  const log = (...parts: unknown[]) => globals.log(text(parts));
  // the script's console, at the component's log levels
  const at = (level: 'debug' | 'warning' | 'error') => (...parts: unknown[]) => globals.log(text(parts), level);
  // the script's timers still to fire (each one a wait until it fires or is cleared)
  const timers = new Map<ReturnType<typeof setTimeout>, () => void>();
  const context = vm.createContext({
    $PARAMETERS: globals.parameters,
    $SECRETS: globals.secrets,
    $VARIABLES: globals.variables,
    $FLOW_CURRENT_RUN: globals.run,
    log,
    console: { log, info: log, warn: at('warning'), error: at('error'), debug: at('debug') },
    // what the script waits for outside counts as Waiting, not Active: its calls (until the whole body is in) and its
    // timers (a sleep)
    fetch: (...args: Parameters<typeof fetch>) => globals.wait(fetch(...args).then(bodyRead)),
    setTimeout: (handler: (...a: unknown[]) => void, ms?: number, ...rest: unknown[]) => {
      let done: () => void = () => {};
      void globals.wait(new Promise<void>(resolve => (done = resolve)));
      const timer = setTimeout(() => {
        done();
        handler(...rest);
      }, ms);
      timers.set(timer, done);
      return timer;
    },
    clearTimeout: (timer: ReturnType<typeof setTimeout>) => {
      timers.get(timer)?.();
      timers.delete(timer);
      clearTimeout(timer);
    },
    Headers,
    Request,
    Response,
    URL,
    URLSearchParams,
    AbortController,
    FormData,
    Blob,
    TextEncoder,
    TextDecoder,
    atob,
    btoa,
    structuredClone,
    crypto: { randomUUID: () => crypto.randomUUID() },
  });
  try {
    vm.runInContext(js, context, { timeout: SYNC_TIMEOUT_MS, filename: 'component.ts' });
  } catch (e) {
    throw toError(e);
  }

  const run = (context as Record<string, unknown>)[EXPORTED];
  if (typeof run !== 'function') {
    throw new Error('The code has no process function.');
  }

  return async (input: unknown) => {
    context.__input = input;
    const promise = vm.runInContext(`${EXPORTED}(__input)`, context, { timeout: SYNC_TIMEOUT_MS }) as Promise<unknown>;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const overrun = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`process took longer than ${CALL_TIMEOUT_MS / 1000} s.`)), CALL_TIMEOUT_MS);
    });
    try {
      return await Promise.race([Promise.resolve(promise), overrun]);
    } finally {
      clearTimeout(timer);
    }
  };
};
