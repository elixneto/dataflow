import { hostname } from 'node:os';
import type { RunProgress, RunRecord, SubRun } from '@dataflow/core';
import { failedRecord, prepareJob } from '#features/runs/run-job';
import { CHANNELS, claimRun, deleteOldTestRuns, failRunsOf, finishRun, heartbeat, reapStaleRuns, saveProgress, STALE_AFTER_MS, type QueuedRun, type RunUsage } from '#features/runs/run-queue';
import type { RunRowStatus } from '#features/runs/run';
import type { Keyring } from '#shared/crypto/keyring';
import type { Database } from '#shared/database/database';
import { createLogger, type LogFields, type Logger } from '#shared/logging/logger';
import type { Execution, Executor } from './workers/executor';

export type SupervisorOptions = {
  db: Database;
  /** decrypts the projects' secrets for the runs */
  keyring?: Keyring;
  /** where the runs go: worker processes, or this process (tests) */
  executor: Executor;
  /** the runs it takes (runs.worker_tag) */
  tags: string[];
  /** this supervisor's id (supervisors table, runs.worker_id); default: host, process and a random part */
  id?: string;
  /** how often it looks for runs without being woken (a missed NOTIFY), reaps lost runs and says it is alive */
  pollMs?: number;
  /** how often the runs it has are marked alive */
  heartbeatMs?: number;
  staleAfterMs?: number;
  /** one event per run and per event worth knowing (default: the console, pretty, info and up) */
  logger?: Logger;
};

/** a run being prepared or run, and the writes of its progress (in order, the latest only when they pile up) */
type Active = { run: QueuedRun; execution: Execution | null; cancelled: boolean; writing: Promise<void>; next: RunProgress | null };

/**
 * Runs what the api queues: claims queued runs (as many as its workers), prepares each one (its secrets decrypted
 * here), hands it to a worker and writes how it goes and how it ended. Woken by NOTIFY when a run is queued or
 * stopped, and every `pollMs` in case it missed one. Several supervisors may share the database: a run goes to one.
 */
export class Supervisor {
  readonly id: string;
  private readonly logger: Logger;
  private readonly active = new Map<string, Active>();
  private readonly stops: (() => Promise<void> | void)[] = [];
  private filling: Promise<void> | null = null;
  private fillAgain = false;
  private stopped = false;
  private cleanedAt = 0;

  constructor(private readonly options: SupervisorOptions) {
    this.id = options.id ?? `${hostname()}-${process.pid}-${crypto.randomUUID().slice(0, 8)}`;
    this.logger = (options.logger ?? createLogger({ service: 'supervisor' })).child({ supervisorId: this.id });
  }

  /**
   * A supervisor of this host whose process is gone (killed: a restart in development, a crash) left its runs
   * running: they fail now instead of when their heartbeat goes stale.
   */
  private async reapOrphans() {
    const prefix = `${hostname()}-`;
    const rows = await this.options.db.query<{ id: string }>('SELECT id FROM supervisors WHERE starts_with(id, $1) AND id <> $2', [prefix, this.id]);
    for (const { id } of rows) {
      const pid = Number(/^(\d+)-/.exec(id.slice(prefix.length))?.[1]);
      if (!Number.isInteger(pid) || alive(pid)) {
        continue;
      }

      for (const run of await failRunsOf(this.options.db, id, 'The supervisor running it stopped.')) {
        this.logger.warn(`Run ${run} failed: its supervisor stopped.`, { runId: run, deadSupervisorId: id });
      }

      await this.options.db.query('DELETE FROM supervisors WHERE id = $1', [id]);
    }
  }

  /** the runs it has now (being prepared or run) */
  get running(): string[] {
    return [...this.active.keys()];
  }

  async start(): Promise<void> {
    const { db, tags, executor, pollMs = 5_000, heartbeatMs = 5_000 } = this.options;
    await db.query(
      `INSERT INTO supervisors (id, tags, workers, last_seen) VALUES ($1, $2::text[], $3, now())
       ON CONFLICT (id) DO UPDATE SET tags = EXCLUDED.tags, workers = EXCLUDED.workers, last_seen = now()`,
      [this.id, tags, executor.size],
    );
    this.stops.push(await db.listen(CHANNELS.queued, tag => {
      if (!tag || tags.includes(tag)) {
        this.fill();
      }
    }));
    this.stops.push(await db.listen(CHANNELS.cancel, id => this.cancel(id)));

    const poll = setInterval(() => {
      void this.reap();
      this.fill();
    }, pollMs);
    const beat = setInterval(() => void this.beat(), heartbeatMs);
    this.stops.push(() => clearInterval(poll), () => clearInterval(beat));
    await this.reapOrphans().catch(error => this.logger.error('Could not check the other supervisors.', { error }));
    await this.reap();
    this.fill();
    await this.filling;
  }

  /** Stops taking runs, ends the ones it has (failed: "The supervisor stopped.") and leaves the supervisors table. */
  async stop(): Promise<void> {
    this.stopped = true;
    for (const stop of this.stops.splice(0)) {
      await stop();
    }

    await this.filling;
    const ending = [...this.active.values()].map(a => a.execution?.done);
    await this.options.executor.close();
    await Promise.all(ending);
    // what finishRun still writes for them
    while (this.active.size > 0) {
      await new Promise(resolve => setTimeout(resolve, 10));
    }

    await this.options.db.query('DELETE FROM supervisors WHERE id = $1', [this.id]);
  }

  /** Claims queued runs while it has free workers; one fill at a time (a call during one makes it look again after). */
  fill(): void {
    if (this.stopped) {
      return;
    }

    if (this.filling) {
      this.fillAgain = true;
      return;
    }

    this.filling = (async () => {
      do {
        this.fillAgain = false;
        while (!this.stopped && this.active.size < this.options.executor.size) {
          const run = await claimRun(this.options.db, this.options.tags, this.id).catch(error => {
            this.logger.error('Could not claim a run.', { error });
            return null;
          });
          if (!run) {
            break;
          }

          this.launch(run);
        }
      } while (this.fillAgain && !this.stopped);
    })().finally(() => (this.filling = null));
  }

  private launch(run: QueuedRun) {
    const { db, keyring, executor } = this.options;
    const active: Active = { run, execution: null, cancelled: run.cancelRequested, writing: Promise.resolve(), next: null };
    this.active.set(run.id, active);
    const started = run.startedAt ?? new Date();
    const log = this.logger.child(runFields(run));
    log.debug(`Run ${run.id} claimed.`, { queuedMs: msBetween(run.queuedAt, started), running: this.active.size });

    const progress = (value: RunProgress) => {
      // one write at a time; while one goes on, only the latest waits for it
      const pending = active.next;
      active.next = value;
      if (!pending) {
        active.writing = active.writing.then(async () => {
          const latest = active.next;
          active.next = null;
          if (latest) {
            await saveProgress(db, run, latest).catch(() => {});
          }
        });
      }
    };

    void (async () => {
      let ended;
      try {
        const job = await prepareJob(db, keyring, run);
        active.execution = executor.run(job, progress);
        if (active.cancelled) {
          active.execution.cancel();
        }

        ended = await active.execution.done;
      } catch (e) {
        const details = { id: run.id, mode: run.mode, projectName: '', flowName: '', startedAt: started };
        ended = { record: failedRecord(details, e instanceof Error ? e.message : String(e)), usage: {} };
        log.error(`Run ${run.id} could not start.`, { error: e });
      }

      await active.writing;
      try {
        const status = await finishRun(db, run, ended.record, ended.usage);
        if (status) {
          logRunEnd(log, this.logger, run, status, ended.record, ended.usage, started);
        } else {
          log.debug(`Run ${run.id} ended; a newer test run had replaced it.`);
        }
      } catch (e) {
        // its heartbeat stops: a supervisor reaps it
        log.error(`Run ${run.id}: its end could not be stored.`, { error: e });
      }

      this.active.delete(run.id);
      this.fill();
    })();
  }

  /** Stop: the worker is told to stop it (the engine stops at its next step; a stuck worker is killed). */
  cancel(id: string): void {
    const active = this.active.get(id);
    if (!active || active.cancelled) {
      return;
    }

    active.cancelled = true;
    active.execution?.cancel();
  }

  private async beat() {
    try {
      await heartbeat(this.options.db, this.running);
      await this.options.db.query('UPDATE supervisors SET last_seen = now() WHERE id = $1', [this.id]);
    } catch (e) {
      this.logger.warn('Heartbeat failed.', { error: e });
    }
  }

  private async reap() {
    try {
      const reaped = await reapStaleRuns(this.options.db, this.options.staleAfterMs ?? STALE_AFTER_MS);
      for (const id of reaped) {
        this.logger.warn(`Run ${id} failed: its worker stopped answering.`, { runId: id });
      }

      // the test runs of more than a day ago, once an hour
      if (Date.now() - this.cleanedAt > 60 * 60_000) {
        this.cleanedAt = Date.now();
        const deleted = await deleteOldTestRuns(this.options.db);
        if (deleted > 0) {
          this.logger.debug(`${deleted} old test run(s) deleted.`, { deleted });
        }
      }
    } catch (e) {
      this.logger.error('Could not reap lost runs.', { error: e });
    }
  }
}

/** what every event of a run carries: which run, of which flow and project, how it was started */
function runFields(run: QueuedRun): LogFields {
  return {
    runId: run.id,
    flowId: run.flowId,
    projectId: run.projectId ?? undefined,
    orgId: run.orgId,
    mode: run.mode,
    trigger: run.trigger,
    testRun: run.table === 'test_runs',
    parentRunId: run.parentId ?? undefined,
    // the run a history groups it under: itself, unless another run queued it
    rootRunId: run.parentId ? undefined : run.id,
  };
}

const total = (ports: Record<string, number>) => Object.values(ports).reduce((n, v) => n + v, 0);

/** ms from one moment to another (a row's timestamps may come as Date or as text) */
const msBetween = (from: Date | string, to: Date | string) => new Date(to).getTime() - new Date(from).getTime();

/** what a record says of itself: flow and project by name, envelopes (Start → End, as the editor's panel), what failed */
function recordFields(record: RunRecord | RunProgress): LogFields {
  const start = record.components.find(c => c.type === 'start');
  const end = record.components.find(c => c.type === 'end');
  const failing = record.components.filter(c => c.status === 'failed' || c.status === 'with-errors');
  return {
    project: record.run.project || undefined,
    flow: record.run.flow || undefined,
    envelopesIn: start ? total(start.outputs) : undefined,
    envelopesOut: end ? total(end.inputs) : undefined,
    components: record.components.length,
    failedComponents: failing.length > 0 ? failing.map(c => `${c.label || c.type} (${c.status})`).join(', ') : undefined,
  };
}

/** completed (or cancelled) is info; with warnings or errors a warning; failed an error */
function logAtStatus(log: Logger, status: string, msg: string, fields: LogFields) {
  if (status === 'failed') {
    log.error(msg, fields);
  } else if (status === 'with-errors' || status === 'with-warnings') {
    log.warn(msg, fields);
  } else {
    log.info(msg, fields);
  }
}

const runName = (id: string, flow: string | undefined) => `Run ${id}${flow ? ` "${flow}"` : ''}`;

/** the runs the record's Flow Invokers called (and the ones those called), with the run and the component that called each */
function calledRuns(record: RunRecord | RunProgress): { sub: SubRun; parentRunId: string; calledBy: string; calledByNodeId: string }[] {
  return record.components.flatMap(c =>
    (c.subRuns ?? []).flatMap(sub => [
      { sub, parentRunId: record.run.id, calledBy: c.label || c.type, calledByNodeId: c.nodeId },
      ...(sub.record ? calledRuns(sub.record) : []),
    ]),
  );
}

/**
 * The run's end: one event for it (status, times, envelopes, what failed, what it used), then one per run its Flow
 * Invokers called (the first MAX_SUB_RUNS of each, those the record keeps), each with its own run_id and its
 * parent_run_id and root_run_id: a run's history finds them all by the root.
 */
function logRunEnd(log: Logger, base: Logger, run: QueuedRun, status: RunRowStatus, record: RunRecord, usage: RunUsage, started: Date) {
  const called = calledRuns(record);
  const fields: LogFields = {
    ...recordFields(record),
    status,
    durationMs: Math.round(record.durationMs),
    queuedMs: msBetween(run.queuedAt, started),
    calledRuns: called.length > 0 ? called.length : undefined,
    from: record.from?.label,
    cpuMs: usage.cpuMs === undefined ? undefined : Math.round(usage.cpuMs),
    peakRssMb: usage.peakRssBytes === undefined ? undefined : Math.round(usage.peakRssBytes / 1024 / 1024),
    error: record.error,
  };
  logAtStatus(log, status, `${runName(run.id, record.run.flow)} ${status} in ${fields.durationMs} ms${record.error ? `: ${record.error}` : ''}`, fields);

  for (const { sub, parentRunId, calledBy, calledByNodeId } of called) {
    const subFields: LogFields = {
      runId: sub.id,
      parentRunId,
      rootRunId: run.parentId ? undefined : run.id,
      orgId: run.orgId,
      mode: run.mode,
      testRun: run.table === 'test_runs',
      trigger: 'flow-invoker',
      calledBy,
      calledByNodeId,
      ...(sub.record ? recordFields(sub.record) : {}),
      flow: sub.flow,
      status: sub.status,
      durationMs: Math.round(sub.durationMs),
      error: sub.error,
    };
    const msg = sub.status === 'running'
      ? `${runName(sub.id, sub.flow)} still running when run ${parentRunId} ended`
      : `${runName(sub.id, sub.flow)} ${sub.status} in ${subFields.durationMs} ms (called by run ${parentRunId})${sub.error ? `: ${sub.error}` : ''}`;
    logAtStatus(base, sub.status, msg, subFields);
  }
}

/** whether a process of this host is still running */
function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    // EPERM: it exists, it is someone else's
    return (e as NodeJS.ErrnoException).code === 'EPERM';
  }
}
