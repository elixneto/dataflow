// Runs the runner in dev and restarts it when its code changes, without corrupting the local database.
// `bun --watch` kills the process on every change, and PGlite stopped in the middle of a write can leave
// runner/data.local unreadable. Here a change asks the runner to stop (a line on its stdin: Windows has no signals
// between processes), waits for it to close the database and only then starts it again.
// Watches only runner/src and core/src (not the tests, the docs, the editor or node_modules). Plain Node.
import {spawn} from 'node:child_process';
import {watch} from 'node:fs';
import {fileURLToPath} from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const WATCHED = ['runner/src', 'core/src'];
/** waits this long after the last change (an editor saving several files restarts once) */
const DEBOUNCE_MS = 300;
/** past this, a runner that did not stop is killed */
const STOP_TIMEOUT_MS = 10_000;

let child = null;
let restarting = false;
let timer = null;

function start() {
  child = spawn('bun', ['runner/src/index.ts'], {
    // no shell: the stop line and a kill must reach bun itself, not a cmd.exe around it
    cwd: ROOT, stdio: ['pipe', 'inherit', 'inherit'], env: {...process.env, RUNNER_STOP_ON_STDIN: '1'},
  });
  child.on('exit', (code) => {
    child = null;
    if (!restarting) console.log(`[dev-runner] the runner stopped (code ${code}); it starts again on the next change.`);
  });
}

/** asks the runner to close the database and leave; resolves when it is gone */
function stop() {
  const current = child;
  if (!current) return Promise.resolve();
  return new Promise((resolve) => {
    const kill = setTimeout(() => {
      console.log('[dev-runner] the runner did not stop in time; killing it.');
      current.kill();
    }, STOP_TIMEOUT_MS);
    current.once('exit', () => {
      clearTimeout(kill);
      resolve();
    });
    current.stdin.write('stop\n');
  });
}

// one restart at a time: two runners must never open the same database
let queue = Promise.resolve();

function restart(file) {
  queue = queue.then(async () => {
    restarting = true;
    console.log(`[dev-runner] ${file} changed: restarting the runner.`);
    await stop();
    restarting = false;
    start();
  });
}

for (const folder of WATCHED) {
  watch(new URL(`../${folder}/`, import.meta.url), {recursive: true}, (_event, file) => {
    if (!file || !/\.(ts|tsx|js|mjs|json)$/.test(file)) return;
    clearTimeout(timer);
    timer = setTimeout(() => restart(`${folder}/${file.replaceAll('\\', '/')}`), DEBOUNCE_MS);
  });
}

// Ctrl+C or concurrently stopping: the runner closes its database first
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    queue = queue.then(async () => {
      restarting = true;
      await stop();
      process.exit(0);
    });
  });
}

start();
