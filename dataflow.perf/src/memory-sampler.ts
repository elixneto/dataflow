import { parentPort } from 'node:worker_threads';

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
