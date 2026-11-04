import { fileURLToPath } from 'node:url';
import type { RunProgress } from '@dataflow/core';
import { failedRecord, stoppedRecord, type RunJob } from '#features/runs/run-job';
import type { Executor, Execution } from './executor';
import type { FromWorker, ToWorker } from './protocol';

const WORKER_FILE = fileURLToPath(new URL('./worker.ts', import.meta.url));

export type PoolOptions = {
  /** worker processes = runs at the same time */
  size: number;
  /** a worker is replaced after this many runs (what a run leaks does not pile up) */
  maxRunsPerWorker?: number;
  /** ... or once a run took its memory past this */
  maxRssBytes?: number;
  /** after Stop, how long a run has to end before its worker is killed */
  cancelGraceMs?: number;
  /** a run that has not ended this long after it started is killed with its worker (past the engine's own timeout) */
  hardTimeoutMs?: number;
};

type Slot = {
  process: ReturnType<typeof Bun.spawn> | null;
  ready: Promise<void>;
  runs: number;
  /** the run it has now */
  current: { job: RunJob; last: RunProgress | null; resolve: (value: Awaited<Execution['done']>) => void; onProgress: (p: RunProgress) => void; timers: Timer[] } | null;
};

/**
 * Worker processes (workers/worker.ts), one run each at a time, talking over IPC. A worker that dies mid-run fails
 * that run with what it did so far and is replaced; one past its runs or memory is replaced between runs.
 */
export function processPool(options: PoolOptions): Executor {
  const { size, maxRunsPerWorker = 100, maxRssBytes = 1024 ** 3, cancelGraceMs = 5_000, hardTimeoutMs = 11 * 60_000 } = options;
  let closing = false;
  const slots: Slot[] = [];

  function finish(slot: Slot, value: Awaited<Execution['done']>) {
    const current = slot.current;
    if (!current) {
      return;
    }

    current.timers.forEach(clearTimeout);
    slot.current = null;
    current.resolve(value);
  }

  function spawn(slot: Slot) {
    let ready: () => void = () => {};
    slot.ready = new Promise(resolve => (ready = resolve));
    slot.runs = 0;
    const child = Bun.spawn(['bun', WORKER_FILE], {
      serialization: 'json',
      // what a worker prints (an unexpected crash) shows in the supervisor's output; runs write only to their records
      stdio: ['ignore', 'inherit', 'inherit'],
      ipc(message: FromWorker) {
        if (message.type === 'ready') {
          ready();
        } else if (message.type === 'progress' && slot.current?.job.id === message.id) {
          slot.current.last = message.progress;
          slot.current.onProgress(message.progress);
        } else if (message.type === 'done' && slot.current?.job.id === message.id) {
          finish(slot, { record: message.record, usage: message.usage });
          // replaced between runs when it ran many or grew too much
          if (slot.runs >= maxRunsPerWorker || (message.usage.peakRssBytes ?? 0) > maxRssBytes) {
            retire(slot);
          }
        }
      },
    });
    slot.process = child;
    void child.exited.then(code => {
      if (slot.process !== child) {
        return;
      }

      slot.process = null;
      const current = slot.current;
      // a run killed on purpose (Stop, timeout) already ended; one still here lost its worker
      if (current) {
        finish(slot, { record: stoppedRecord(current.last, { ...current.job }, `The worker running it stopped unexpectedly (exit code ${code}).`), usage: {} });
      }

      if (!closing) {
        spawn(slot);
      }
    });
  }

  /** ends a worker and starts its replacement at once (the next run must not go to the one ending) */
  function retire(slot: Slot) {
    const old = slot.process;
    slot.process = null;
    old?.kill();
    if (!closing) {
      spawn(slot);
    }
  }

  for (let i = 0; i < size; i++) {
    const slot: Slot = { process: null, ready: Promise.resolve(), runs: 0, current: null };
    slots.push(slot);
    spawn(slot);
  }

  return {
    size,
    run(job, onProgress) {
      const slot = slots.find(s => !s.current);
      if (!slot) {
        return { done: Promise.resolve({ record: failedRecord({ ...job }, 'No worker is free.'), usage: {} }), cancel: () => {} };
      }

      let resolve: (value: Awaited<Execution['done']>) => void = () => {};
      const done = new Promise<Awaited<Execution['done']>>(r => (resolve = r));
      slot.current = { job, last: null, resolve, onProgress, timers: [] };
      slot.runs++;
      const current = slot.current;
      const kill = (reason: string) => {
        if (slot.current === current) {
          finish(slot, { record: stoppedRecord(current.last, { ...job }, reason), usage: {} });
          retire(slot);
        }
      };
      current.timers.push(setTimeout(() => kill(`The run took longer than ${Math.round(hardTimeoutMs / 60_000)} minutes and was stopped.`), hardTimeoutMs));
      void slot.ready.then(() => slot.process?.send({ type: 'run', job } satisfies ToWorker));
      return {
        done,
        cancel() {
          if (slot.current !== current) {
            return;
          }

          slot.process?.send({ type: 'cancel', id: job.id } satisfies ToWorker);
          // the engine stops at its next step; a component stuck in a call does not: its worker goes
          current.timers.push(setTimeout(() => kill('Run cancelled.'), cancelGraceMs));
        },
      };
    },
    async close() {
      closing = true;
      await Promise.all(slots.map(async slot => {
        const child = slot.process;
        slot.process = null;
        child?.kill();
        await child?.exited;
        if (slot.current) {
          finish(slot, { record: stoppedRecord(slot.current.last, { ...slot.current.job }, 'The supervisor stopped.'), usage: {} });
        }
      }));
    },
  };
}
