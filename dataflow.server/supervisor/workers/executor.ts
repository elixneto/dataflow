import type { QueueFlow, RunProgress, RunRecord, SendHttp } from '@dataflow/core';
import { runJob, type RunJob } from '#features/runs/run-job';
import type { RunUsage } from '#features/runs/run-queue';

/** a run handed to a worker: its end (always resolves, a lost worker included) and how to stop it */
export type Execution = { done: Promise<{ record: RunRecord; usage: RunUsage }>; cancel(): void };

/** what the supervisor does for a run while it goes: queue its fire and forget calls (in the database, its parent the run) */
export type RunHooks = { queueFlow?: QueueFlow };

/**
 * Where the supervisor's runs go: worker processes (process-pool.ts), or this process (the tests). `size`: how many run
 * at the same time; the supervisor never hands more.
 */
export interface Executor {
  readonly size: number;
  run(job: RunJob, onProgress: (progress: RunProgress) => void, hooks?: RunHooks): Execution;
  close(): Promise<void>;
}

/** Runs the jobs in this process (tests: HTTP faked, no process to start); what it used is this process's. */
export function inProcessExecutor(options: { size?: number; http?: SendHttp } = {}): Executor {
  return {
    size: options.size ?? 4,
    run(job, onProgress, hooks = {}) {
      const abort = new AbortController();
      const startRssBytes = process.memoryUsage().rss;
      const cpu = process.cpuUsage();
      const done = runJob(job, { http: options.http, onProgress, signal: abort.signal, queueFlow: hooks.queueFlow }).then(record => {
        const used = process.cpuUsage(cpu);
        return { record, usage: { startRssBytes, peakRssBytes: Math.max(startRssBytes, process.memoryUsage().rss), cpuMs: (used.user + used.system) / 1000 } };
      });
      return { done, cancel: () => abort.abort() };
    },
    close: async () => {},
  };
}
