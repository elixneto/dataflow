import { runJob } from '#features/runs/run-job';
import type { FromWorker, ToWorker } from './protocol';

/*
 * A worker process: started by the supervisor (workers/process-pool.ts), it runs the jobs it is sent, one at a time,
 * and ends with its supervisor (when the IPC channel closes). What the runs write goes to their records, never here.
 */

const send = (message: FromWorker) => process.send?.(message);
const running = new Map<string, AbortController>();

/** the process's resident memory, sampled while a run goes on: its peak is the run's */
function memoryWatch() {
  const start = process.memoryUsage().rss;
  let peak = start;
  const timer = setInterval(() => (peak = Math.max(peak, process.memoryUsage().rss)), 100);
  return {
    start,
    stop: () => {
      clearInterval(timer);
      return Math.max(peak, process.memoryUsage().rss);
    },
  };
}

async function run(job: Extract<ToWorker, { type: 'run' }>['job']) {
  const abort = new AbortController();
  running.set(job.id, abort);
  const memory = memoryWatch();
  const cpu = process.cpuUsage();
  const record = await runJob(job, {
    signal: abort.signal,
    onProgress: progress => send({ type: 'progress', id: job.id, progress }),
  });
  const used = process.cpuUsage(cpu);
  running.delete(job.id);
  send({ type: 'done', id: job.id, record, usage: { startRssBytes: memory.start, peakRssBytes: memory.stop(), cpuMs: (used.user + used.system) / 1000 } });
}

process.on('message', (message: ToWorker) => {
  if (message.type === 'run') {
    void run(message.job);
  } else if (message.type === 'cancel') {
    running.get(message.id)?.abort();
  }
});

// its supervisor is gone: nobody would get what it runs
process.on('disconnect', () => process.exit(0));
send({ type: 'ready' });
