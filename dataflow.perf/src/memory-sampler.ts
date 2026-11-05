import { parentPort } from 'node:worker_threads';

/*
 * The memory sampler of a measured run, in a thread of its own: it reads the process's resident memory (the whole
 * process, the engine's thread included) every few milliseconds and keeps the peak. A timer on the engine's thread
 * would not do: the engine passes envelopes through promises and never yields to timers, so a flow without I/O would
 * only let it fire at the end.
 */

const INTERVAL_MS = 10;

let peak = 0;
let samples = 0;
const sample = () => {
  peak = Math.max(peak, process.memoryUsage.rss());
  samples += 1;
};

sample();
const timer = setInterval(sample, INTERVAL_MS);
parentPort?.on('message', (message: { type: 'stop' }) => {
  if (message.type === 'stop') {
    clearInterval(timer);
    sample();
    parentPort?.postMessage({ type: 'peak', peakRssBytes: peak, samples });
  }
});
parentPort?.postMessage({ type: 'ready' });
