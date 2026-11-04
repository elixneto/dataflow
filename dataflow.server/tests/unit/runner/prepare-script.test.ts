import { expect, test } from 'bun:test';

process.env.SCRIPT_SYNC_TIMEOUT_MS = '300';
const { prepareScript } = await import('#shared/runner/prepare-script');

const logs: string[] = [];
const globals = {
  run: { id: 'r1', mode: 'validation' as const, project: 'P', flow: 'F', startedAt: '2026-11-04T00:00:00Z' },
  parameters: { region: 'eu' },
  secrets: { TOKEN: 's3cret' },
  variables: { BASE: 'https://api.test' },
  log: (message: string) => logs.push(message),
  // what the script waits for outside, as the engine would take it
  wait: <T>(promise: Promise<T>) => {
    waits.push('wait');
    return promise;
  },
};
const waits: string[] = [];

const SCRIPTS = {
  'upload/types': `export interface IUploadInitResponse { file: { uploadId: string } }
export function uploadIdOf(response: IUploadInitResponse): string { return response.file.uploadId; }`,
  'upload/headers': `import { uploadIdOf, type IUploadInitResponse } from '@myproject/scripts/upload/types';
export const header = (r: IUploadInitResponse) => 'id=' + uploadIdOf(r);`,
};

test('process runs with the run globals and log; types do not stop it', async () => {
  logs.length = 0;
  const process = await prepareScript(
    `async function process($input: Data): Promise<unknown> {
  const wrong: number = 'types are not checked here';
  log('hi', $input.n, $PARAMETERS.region, $VARIABLES.BASE, $FLOW_CURRENT_RUN.mode);
  console.log({ok: true});
  return { double: $input.n * 2, hasSecret: typeof $SECRETS.TOKEN === 'string' };
}`,
    globals,
  );
  expect(await process({ n: 21 })).toEqual({ double: 42, hasSecret: true });
  expect(logs).toEqual(['hi 21 eu https://api.test validation', '{"ok":true}']);
});

test("it imports the project's scripts, which import each other", async () => {
  const process = await prepareScript(
    `import { header } from '@myproject/scripts/upload/headers';
import type { IUploadInitResponse } from '@myproject/scripts/upload/types';
async function process($input: IUploadInitResponse) { return header($input); }`,
    globals,
    SCRIPTS,
  );
  expect(await process({ file: { uploadId: 'u7' } })).toBe('id=u7');
});

test('what does not compile says why: an unknown script, a package, a syntax error (with its line)', async () => {
  await expect(prepareScript(`import { x } from '@myproject/scripts/nope';\nasync function process() { return x; }`, globals, SCRIPTS)).rejects.toThrow(
    'The script "@myproject/scripts/nope" does not exist in this project.',
  );
  await expect(prepareScript(`import fs from 'node:fs';\nasync function process() { return fs; }`, globals)).rejects.toThrow(
    `"node:fs" cannot be imported: only the project's scripts (@myproject/scripts/<path>).`,
  );
  await expect(prepareScript(`async function process() {\n  return (;\n}`, globals)).rejects.toThrow(/does not compile: .*line 2/);
  await expect(prepareScript(`const x = 1;`, globals)).rejects.toThrow('The code has no process function.');
});

test('isolated: no process, require, Bun or disk; an endless loop is stopped', async () => {
  const peek = await prepareScript(`async function process() { return [typeof Bun, typeof globalThis.process, typeof fetch]; }`, globals);
  expect(await peek(null)).toEqual(['undefined', 'undefined', 'function']);
  // a require is an import to the bundle: refused like any other that is not a project script
  await expect(prepareScript(`async function process() { return require('node:fs'); }`, globals)).rejects.toThrow('"node:fs" cannot be imported');
  const loop = await prepareScript(`async function process() { while (true) {} }`, globals);
  await expect(loop(null)).rejects.toThrow(/timed out|timeout/i);
});

test("what the script waits for outside goes through the engine's wait: its timers (a sleep) and its calls", async () => {
  waits.length = 0;
  const server = Bun.serve({ port: 0, fetch: () => Response.json({ ok: true }) });
  try {
    const process = await prepareScript(
      `async function process() {
  await new Promise(resolve => setTimeout(resolve, 20));
  const response = await fetch('http://localhost:${server.port}/');
  return (await response.json()).ok;
}`,
      globals,
    );
    expect(await process(null)).toBe(true);
    expect(waits).toEqual(['wait', 'wait']);
    // a timer cleared before it fires ends its wait too
    const cleared = await prepareScript(`async function process() { clearTimeout(setTimeout(() => {}, 10_000)); return 'done'; }`, globals);
    expect(await cleared(null)).toBe('done');
  } finally {
    server.stop(true);
  }
});
