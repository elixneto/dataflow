import { hostname } from 'node:os';
import type { RunProgress } from '@dataflow/core';
import { failedRecord, prepareJob } from '#features/runs/run-job';
import { CHANNELS, claimRun, deleteOldTestRuns, failRunsOf, finishRun, heartbeat, reapStaleRuns, saveProgress, STALE_AFTER_MS, type QueuedRun } from '#features/runs/run-queue';
import type { Keyring } from '#shared/crypto/keyring';
import type { Database } from '#shared/database/database';
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
  /** one line per run and per event worth knowing (default: the console) */
  log?: (line: string) => void;
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
  private readonly active = new Map<string, Active>();
  private readonly stops: (() => Promise<void> | void)[] = [];
  private filling: Promise<void> | null = null;
  private fillAgain = false;
  private stopped = false;
  private cleanedAt = 0;

  constructor(private readonly options: SupervisorOptions) {
    this.id = options.id ?? `${hostname()}-${process.pid}-${crypto.randomUUID().slice(0, 8)}`;
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
        this.log(`Run ${run} failed: its supervisor stopped.`);
      }

      await this.options.db.query('DELETE FROM supervisors WHERE id = $1', [id]);
    }
  }

  private log(line: string) {
    (this.options.log ?? console.info)(line);
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
    await this.reapOrphans().catch(error => this.log(`Could not check the other supervisors: ${(error as Error).message}`));
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
            this.log(`Could not claim a run: ${(error as Error).message}`);
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
      }

      await active.writing;
      try {
        const status = await finishRun(db, run, ended.record, ended.usage);
        this.log(status ? `Run ${run.id} ${status} in ${Math.round(ended.record.durationMs)} ms.` : `Run ${run.id} ended; a newer test run had replaced it.`);
      } catch (e) {
        // its heartbeat stops: a supervisor reaps it
        this.log(`Run ${run.id}: its end could not be stored (${(e as Error).message}).`);
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
      this.log(`Heartbeat failed: ${(e as Error).message}`);
    }
  }

  private async reap() {
    try {
      const reaped = await reapStaleRuns(this.options.db, this.options.staleAfterMs ?? STALE_AFTER_MS);
      for (const id of reaped) {
        this.log(`Run ${id} failed: its worker stopped answering.`);
      }

      // the test runs of more than a day ago, once an hour
      if (Date.now() - this.cleanedAt > 60 * 60_000) {
        this.cleanedAt = Date.now();
        await deleteOldTestRuns(this.options.db);
      }
    } catch (e) {
      this.log(`Could not reap lost runs: ${(e as Error).message}`);
    }
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
