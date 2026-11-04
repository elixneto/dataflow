import type { RunProgress, RunRecord } from '@dataflow/core';
import type { Database } from '#shared/database/database';
import type { RunUsageView } from './get-run/get-run-handler';
import { CHANNELS, findRun, type RunEventNotice } from './run-queue';

/**
 * What happens in the runs going on, for whoever follows them in this api (GET /runs/:id/events, SSE): the run so far
 * a few times a second, then its record. The runs go on in the supervisor (another process): it stores each change in
 * the run's row and says so with a NOTIFY (CHANNELS.events); followRunEvents reads the row and publishes it here, only
 * for the runs someone follows.
 */
export type RunEvent = { type: 'progress'; progress: RunProgress } | { type: 'done'; record: RunRecord; usage?: RunUsageView | null };

const listeners = new Map<string, Set<(event: RunEvent) => void>>();

export const runEvents = {
  publish(runId: string, event: RunEvent) {
    listeners.get(runId)?.forEach(listener => listener(event));
    if (event.type === 'done') {
      listeners.delete(runId);
    }
  },
  /** whether someone in this process follows the run */
  followed: (runId: string) => (listeners.get(runId)?.size ?? 0) > 0,
  /** follows a run until it is done; the answer stops following it */
  subscribe(runId: string, listener: (event: RunEvent) => void): () => void {
    const set = listeners.get(runId) ?? new Set();
    set.add(listener);
    listeners.set(runId, set);
    return () => {
      set.delete(listener);
      if (set.size === 0 && listeners.get(runId) === set) {
        listeners.delete(runId);
      }
    };
  },
};

/**
 * Listens to the supervisors' notices and publishes, for the runs followed here, the run so far or its record (read
 * from its row: a notice carries only the id). Reads of one run go one at a time, the latest notice winning.
 */
export async function followRunEvents(db: Database): Promise<() => Promise<void>> {
  const reading = new Map<string, Promise<void>>();
  const again = new Set<string>();

  const read = async (id: string) => {
    const row = await findRun(db, id);
    if (!row) {
      // a test run replaced by a newer one: whoever still follows it is told it ended
      runEvents.publish(id, { type: 'done', record: replacedRecord(id) });
      return;
    }

    if (row.status !== 'queued' && row.status !== 'running' && row.record) {
      runEvents.publish(id, { type: 'done', record: row.record as RunRecord, usage: usageOf(row) });
    } else if (row.status === 'running' && row.progress) {
      runEvents.publish(id, { type: 'progress', progress: row.progress as RunProgress });
    }
  };

  const onNotice = (payload: string) => {
    let notice: RunEventNotice;
    try {
      notice = JSON.parse(payload) as RunEventNotice;
    } catch {
      return;
    }

    if (!runEvents.followed(notice.id)) {
      return;
    }

    if (reading.has(notice.id)) {
      again.add(notice.id);
      return;
    }

    const loop = async () => {
      do {
        again.delete(notice.id);
        await read(notice.id).catch(() => {});
      } while (again.has(notice.id));
      reading.delete(notice.id);
    };
    reading.set(notice.id, loop());
  };

  return db.listen(CHANNELS.events, onNotice);
}

/** the end of a test run that a newer one replaced (its row is gone) */
export const replacedRecord = (id: string): RunRecord => ({
  run: { id, mode: 'validation', project: '', flow: '', startedAt: new Date().toISOString() },
  parameters: {},
  status: 'failed',
  end: new Date().toISOString(),
  durationMs: 0,
  error: 'A newer test run of this flow replaced it.',
  components: [],
});

/** what a run's worker used, from its row (bigint columns may come back as text) */
export function usageOf(row: { startRssBytes: unknown; peakRssBytes: unknown; cpuMs: unknown }): RunUsageView | null {
  const count = (value: unknown) => (value === null || value === undefined ? null : Number(value));
  const usage = { startRssBytes: count(row.startRssBytes), peakRssBytes: count(row.peakRssBytes), cpuMs: count(row.cpuMs) };
  return usage.peakRssBytes === null && usage.cpuMs === null ? null : usage;
}
