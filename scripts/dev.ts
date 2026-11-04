/*
 * `bun run dev` at the root: the api (dataflow.server, :5190), the supervisor (its workers run the runs) and the
 * editor (dataflow.editor, :5180) together, each line prefixed with its name. Ctrl+C (or any of them stopping) stops
 * them all, process trees included: on Windows, `bun run --filter` left them running.
 */

import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

type App = { name: string; cwd: string; cmd: string[]; color: string };

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const RESET = '\x1b[0m';
const SERVER_ENV = `${ROOT}dataflow.server/.env`;
const ENV_FILE = existsSync(SERVER_ENV) ? [`--env-file=${SERVER_ENV}`] : [];
const APPS: App[] = [
  // the api runs from the repository root, so --watch also restarts it when dataflow.core changes (Bun watches only the
  // folder it runs in); its .env stays in dataflow.server and is passed explicitly
  {
    name: 'server',
    cwd: ROOT,
    cmd: ['bun', '--watch', ...ENV_FILE, 'dataflow.server/api/server.ts'],
    color: '\x1b[36m',
  },
  // restarted on a change like the api; the runs it had fail ("its supervisor stopped") and the new one goes on
  { name: 'supervisor', cwd: ROOT, cmd: ['bun', '--watch', ...ENV_FILE, 'dataflow.server/supervisor/main.ts'], color: '\x1b[33m' },
  { name: 'editor', cwd: `${ROOT}dataflow.editor`, cmd: ['bun', 'run', 'dev'], color: '\x1b[35m' },
];

async function pipe(stream: ReadableStream<Uint8Array>, prefix: string, out: NodeJS.WriteStream) {
  const decoder = new TextDecoder();
  let pending = '';
  for await (const chunk of stream) {
    const lines = (pending + decoder.decode(chunk, { stream: true })).split(/\r?\n/);
    pending = lines.pop() ?? '';
    for (const line of lines) {
      out.write(`${prefix}${line}\n`);
    }
  }

  if (pending) {
    out.write(`${prefix}${pending}\n`);
  }
}

const children = APPS.map(app => {
  const child = Bun.spawn(app.cmd, {
    cwd: app.cwd,
    stdin: 'ignore',
    stdout: 'pipe',
    stderr: 'pipe',
    env: { ...process.env, FORCE_COLOR: '1' },
  });
  const prefix = `${app.color}[${app.name}]${RESET} `;
  void pipe(child.stdout, prefix, process.stdout);
  void pipe(child.stderr, prefix, process.stderr);
  return { app, child };
});

let stopping = false;

/** kills them all, with everything they started (bun run -> vite, the watchers, the workers) */
function stopAll(code: number) {
  if (stopping) {
    return;
  }

  stopping = true;
  for (const { child } of children) {
    if (child.exitCode !== null) {
      continue;
    }

    if (process.platform === 'win32') {
      Bun.spawnSync(['taskkill', '/pid', String(child.pid), '/T', '/F'], { stdout: 'ignore', stderr: 'ignore' });
    } else {
      child.kill('SIGTERM');
    }
  }

  process.exit(code);
}

process.on('SIGINT', () => stopAll(0));
process.on('SIGTERM', () => stopAll(0));
process.on('SIGBREAK', () => stopAll(0));

for (const { app, child } of children) {
  void child.exited.then(code => {
    if (!stopping) {
      console.log(`${app.color}[${app.name}]${RESET} stopped (code ${code}); stopping the others too.`);
      stopAll(code ?? 1);
    }
  });
}
