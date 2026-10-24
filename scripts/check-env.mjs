// Checks the tools a dev needs before `npm run setup` and `npm run start`: Node.js 24+ and Bun 1.2+.
// Plain Node, no dependencies, so it runs before anything is installed.
import {execFileSync} from 'node:child_process';

const NODE_MIN = [24, 0];
const BUN_MIN = [1, 2];

const parse = (version) => version.replace(/^v/, '').split('.').map(Number);
const atLeast = (version, min) => {
  const [major, minor] = parse(version);
  return major > min[0] || (major === min[0] && minor >= min[1]);
};

const problems = [];

if (!atLeast(process.versions.node, NODE_MIN)) {
  problems.push(`Node.js ${NODE_MIN.join('.')}+ is required (found ${process.versions.node}). With nvm: \`nvm install && nvm use\` (reads .nvmrc).`);
}

let bun = null;
try {
  bun = execFileSync('bun', ['--version'], {encoding: 'utf8', shell: process.platform === 'win32'}).trim();
} catch {
  problems.push('Bun is not installed (the runner and the tests run on it). Install it from https://bun.sh and open a new terminal.');
}
if (bun && !atLeast(bun, BUN_MIN)) {
  problems.push(`Bun ${BUN_MIN.join('.')}+ is required (found ${bun}). Update it with \`bun upgrade\`.`);
}

if (problems.length > 0) {
  console.error(['Environment check failed:', ...problems.map((p) => `  - ${p}`)].join('\n'));
  process.exit(1);
}
console.log(`Environment ok: Node.js ${process.versions.node}, Bun ${bun}.`);
