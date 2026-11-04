import type { RunProgress, RunRecord } from '@dataflow/core';
import type { RunJob } from '#features/runs/run-job';
import type { RunUsage } from '#features/runs/run-queue';

/*
 * What the supervisor and a worker process say to each other (Bun's IPC, as JSON). A worker runs one job at a time and
 * never touches the database: it gets the job (secrets included, kept in its memory for that run only) and answers
 * with the run as it goes and its end.
 */

export type ToWorker = { type: 'run'; job: RunJob } | { type: 'cancel'; id: string };

export type FromWorker =
  | { type: 'ready' }
  | { type: 'progress'; id: string; progress: RunProgress }
  | { type: 'done'; id: string; record: RunRecord; usage: RunUsage };
