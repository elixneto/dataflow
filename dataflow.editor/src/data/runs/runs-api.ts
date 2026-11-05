import { api, apiHeaders, type ApiResult } from '@/lib/api';
import { parseEvents } from '@/data/flows/run-events';
import type { RunFilter, RunPeriod, RunStatus, RunSummary, RunTrigger } from './run-history';

/*
 * The Runs page's api (dataflow.server: features/runs/list-runs): the top runs a page at a time with their trees, the
 * numbers above the list, a run's tree, and the organization's changes as they happen (SSE).
 */

/** a run as the api answers it (dates as text, nothing as null) */
type RunDto = {
  id: string;
  status: RunStatus;
  trigger: RunTrigger;
  projectId: string | null;
  projectName: string | null;
  flowId: string;
  flowName: string | null;
  startedBy: string | null;
  queuedAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  durationMs: number | null;
  envelopesIn: number | null;
  envelopesOut: number | null;
  error: string | null;
  workerId: string | null;
  parentId: string | null;
  rootId: string | null;
  calledBy: string | null;
  batchSize: number | null;
};

const date = (v: string | null) => (v ? new Date(v) : undefined);
const some = <T,>(v: T | null) => (v === null ? undefined : v);

export const toRunSummary = (dto: RunDto): RunSummary => ({
  id: dto.id,
  status: dto.status,
  trigger: dto.trigger,
  projectId: dto.projectId ?? '',
  projectName: dto.projectName ?? '',
  flowId: dto.flowId,
  flowName: dto.flowName ?? 'Flow',
  startedBy: some(dto.startedBy),
  queuedAt: new Date(dto.queuedAt),
  startedAt: date(dto.startedAt),
  finishedAt: date(dto.finishedAt),
  durationMs: some(dto.durationMs),
  envelopesIn: some(dto.envelopesIn),
  envelopesOut: some(dto.envelopesOut),
  error: some(dto.error),
  workerId: some(dto.workerId),
  parentId: some(dto.parentId),
  rootId: some(dto.rootId),
  calledBy: some(dto.calledBy),
  batchSize: some(dto.batchSize),
});

/** a page of top runs with the runs of their trees; `treeSizes`: how many runs each tree has in all (it may show fewer) */
export type RunPage = { runs: RunSummary[]; treeSizes: Record<string, number>; next: string | null };

/** the top runs that fit the filter (or with a run of their tree that does), newest first, a page at a time */
export async function listRuns(filter: RunFilter, before?: string, limit = 20): Promise<ApiResult<RunPage>> {
  const query = new URLSearchParams({ limit: String(limit) });
  if (filter.status !== 'all') query.set('status', filter.status);
  if (filter.projectId) query.set('project', filter.projectId);
  if (filter.trigger !== 'all') query.set('trigger', filter.trigger);
  if (filter.search.trim()) query.set('q', filter.search.trim());
  if (filter.period) query.set('period', filter.period);
  if (before) query.set('before', before);
  const result = await api<{ runs: RunDto[]; treeSizes: Record<string, number>; next: string | null }>(`/runs?${query}`);
  return result.ok ? { ok: true, value: { ...result.value, runs: result.value.runs.map(toRunSummary) } } : result;
}

/** the numbers above the list */
export type RunNumbers = { all: number; running: number; inFlight: number; queued: number; oldestWaitMs: number; problems: number; completed: number };

export const getRunNumbers = (period: RunPeriod = '24h') => api<RunNumbers>(`/runs/overview?period=${period}`);


/** a run of the organization that changed: queued, taken by a worker, or ended */
export type RunChange = { id: string; rootId: string; status: RunStatus };

/** a stream with nothing for this long (the server pings every 5 s) is taken as dead: it is closed and opened again */
const SILENT_MS = 30_000;

/**
 * Follows the organization's run changes (GET /runs/events, SSE, read with fetch for the api's headers) until `signal`
 * aborts: each change to `onChange`, `onOpen` once it is connected. Resolves when the stream ends, fails or goes silent
 * for SILENT_MS (a proxy can keep a connection open after the server closed it): then the caller opens it again.
 */
export async function followRunChanges(onChange: (change: RunChange) => void, signal: AbortSignal, onOpen?: () => void, silentMs = SILENT_MS): Promise<void> {
  const own = new AbortController();
  const stop = () => own.abort();
  signal.addEventListener('abort', stop);
  let heard = Date.now();
  const watchdog = setInterval(() => Date.now() - heard > silentMs && stop(), Math.min(5000, silentMs / 2));
  try {
    const response = await fetch('/api/runs/events', { headers: { ...apiHeaders(), accept: 'text/event-stream' }, signal: own.signal });
    if (!response.ok || !response.body) return;
    const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
    let buffer = '';
    for (;;) {
      const { value, done } = await reader.read();
      if (done) return;
      heard = Date.now();
      const parsed = parseEvents(buffer + value.replace(/\r\n/g, '\n'));
      buffer = parsed.rest;
      for (const event of parsed.events) {
        if (event.type === 'ready') onOpen?.();
        else if (event.type === 'change') onChange(JSON.parse(event.data) as RunChange);
      }
    }
  } catch {
    // aborted, silent for too long, or the connection dropped
  } finally {
    clearInterval(watchdog);
    signal.removeEventListener('abort', stop);
  }
}
