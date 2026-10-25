// Runs the runner in dev (and, with --with-editor, the editor too: `npm run start`) and restarts the runner when its
// code changes, without corrupting the local database. PGlite stopped in the middle of a write can leave
// runner/data.local unreadable, and on Windows every "kill" (bun --watch, concurrently, tree-kill) is immediate. So
// the runner is only ever stopped by asking it (a line on its stdin: Windows has no signals between processes) and
// waiting for it to close the database: on a change (then it starts again), on Ctrl+C, when this script is stopped.
// Watches only runner/src and core/src (not the tests, the docs, the editor or node_modules). Plain Node.
import {spawn} from 'node:child_process';
import {watch} from 'node:fs';
import {fileURLToPath} from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const WATCHED = ['runner/src', 'core/src'];
const WITH_EDITOR = process.argv.includes('--with-editor');
/** waits this long after the last change (an editor saving several files restarts once) */
const DEBOUNCE_MS = 300;
/** past this, a runner that did not stop is killed */
const STOP_TIMEOUT_MS = 15_000;

const COLORS = {runner: '\x1b[35m', editor: '\x1b[36m'};
const say = (message) => console.log(`${COLORS.runner}[dev-runner]\x1b[0m ${message}`);

/** the child's output, line by line, with its name in front (like concurrently did) */
function prefixed(name, stream) {
  let rest = '';
  stream.on('data', (chunk) => {
    const lines = (rest + chunk).split(/\r?\n/);
    rest = lines.pop() ?? '';
    for (const line of lines) process.stdout.write(`${COLORS[name]}[${name}]\x1b[0m ${line}\n`);
  });
}

let runner = null;
let editor = null;
let leaving = false;
let restarting = false;
let timer = null;

function startRunner() {
  // no shell: the stop line must reach bun itself, not a cmd.exe around it. Detached: on Windows a child that is not
  // dies at once with this script (it is in its job object); detached, it sees its stdin close and stops cleanly.
  const child = spawn('bun', ['runner/src/index.ts'], {
    cwd: ROOT, stdio: ['pipe', 'pipe', 'pipe'], env: {...process.env, RUNNER_STOP_ON_STDIN: '1'}, detached: true, windowsHide: true,
  });
  prefixed('runner', child.stdout);
  prefixed('runner', child.stderr);
  child.on('exit', (code) => {
    if (runner === child) runner = null;
    if (!leaving && !restarting) say(`the runner stopped (code ${code}); it starts again on the next change.`);
  });
  runner = child;
}

/** asks the runner to close the database and leave; resolves when it is gone */
function stopRunner() {
  const child = runner;
  if (!child || child.exitCode !== null) return Promise.resolve();
  return new Promise((resolve) => {
    const kill = setTimeout(() => {
      say('the runner did not stop in time; killing it.');
      child.kill();
    }, STOP_TIMEOUT_MS);
    child.once('exit', () => {
      clearTimeout(kill);
      resolve();
    });
    child.stdin.write('stop\n');
  });
}

function startEditor() {
  // the editor has no state to lose: it is simply closed at the end
  editor = spawn('npm', ['--prefix', 'editor', 'run', 'start'], {cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'], shell: true});
  prefixed('editor', editor.stdout);
  prefixed('editor', editor.stderr);
}

function stopEditor() {
  if (!editor || editor.exitCode !== null) return;
  // npm and vite under a shell: the whole tree goes
  if (process.platform === 'win32') spawn('taskkill', ['/pid', String(editor.pid), '/T', '/F'], {stdio: 'ignore'});
  else editor.kill('SIGTERM');
}

// one change at a time: two runners must never open the same database
let queue = Promise.resolve();

function restart(file) {
  queue = queue.then(async () => {
    if (leaving) return;
    restarting = true;
    say(`${file} changed: restarting the runner.`);
    await stopRunner();
    restarting = false;
    startRunner();
  });
}

/** Ctrl+C, a stop from outside, the end of this script: the runner closes its database first */
function leave(reason) {
  if (leaving) return;
  leaving = true;
  say(`${reason}: stopping.`);
  queue = queue.then(async () => {
    await stopRunner();
    stopEditor();
    process.exit(0);
  });
}

for (const folder of WATCHED) {
  watch(new URL(`../${folder}/`, import.meta.url), {recursive: true}, (_event, file) => {
    if (!file || !/\.(ts|tsx|js|mjs|json)$/.test(file)) return;
    clearTimeout(timer);
    timer = setTimeout(() => restart(`${folder}/${file.replaceAll('\\', '/')}`), DEBOUNCE_MS);
  });
}

for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP', 'SIGBREAK']) process.on(signal, () => leave(signal));

startRunner();
if (WITH_EDITOR) startEditor();
