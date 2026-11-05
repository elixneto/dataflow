import { tokenStillGood, type OAuthToken, type OAuthTokenRequest, type OAuthTokenSource, type SourcedOAuthToken } from '@dataflow/core';
import { runJob } from '#features/runs/run-job';
import type { FromWorker, ToWorker } from './protocol';
import { closeSqlServerPools } from '#shared/runner/sqlserver-driver';
import { closeMongoClients } from '#shared/runner/mongodb-driver';

/*
 * A worker process: started by the supervisor (workers/process-pool.ts), it runs the jobs it is sent, one at a time,
 * and ends with its supervisor (when the IPC channel closes). What the runs write goes to their records, never here.
 * The OAuth 2.0 tokens its runs need it asks the supervisor, which keeps them for all its workers (one per connection).
 */

const send = (message: FromWorker) => process.send?.(message);
const running = new Map<string, AbortController>();

/** the asks for a token on their way to the supervisor, by number */
const asks = new Map<number, { resolve: (token: SourcedOAuthToken) => void; reject: (error: Error) => void }>();
let lastAsk = 0;
const askSupervisor = (request: OAuthTokenRequest) =>
  new Promise<SourcedOAuthToken>((resolve, reject) => {
    const ask = ++lastAsk;
    asks.set(ask, { resolve, reject });
    send({ type: 'token', ask, request });
  });

/**
 * A run's tokens: the supervisor's, with a copy for the run (its next requests do not ask again while it is good and
 * the connection the same); a refused one asks the supervisor, with it.
 */
function supervisorTokens(): OAuthTokenSource {
  const copies = new Map<string, { fingerprint: string; token: OAuthToken }>();
  return async request => {
    const copy = copies.get(request.key);
    if (!request.refused && copy && copy.fingerprint === request.fingerprint && tokenStillGood(copy.token)) {
      return copy.token;
    }

    const got = await askSupervisor(request);
    copies.set(request.key, { fingerprint: request.fingerprint, token: { accessToken: got.accessToken, expiresAt: got.expiresAt } });
    return got;
  };
}

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
    oauthTokens: supervisorTokens(),
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
  } else if (message.type === 'token') {
    const waiting = asks.get(message.ask);
    asks.delete(message.ask);
    if (message.token) {
      waiting?.resolve(message.token);
    } else {
      waiting?.reject(new Error(message.error ?? 'The supervisor gave no OAuth 2.0 token.'));
    }
  }
});

// its supervisor is gone: nobody would get what it runs
// the supervisor is gone: the databases' connections closed (at most a second), then out
process.on('disconnect', () => {
  void Promise.race([Promise.all([closeSqlServerPools(), closeMongoClients()]), new Promise(resolve => setTimeout(resolve, 1000))]).finally(() => process.exit(0));
});
send({ type: 'ready' });
