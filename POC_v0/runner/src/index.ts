import {Hono} from 'hono';
import {logger} from 'hono/logger';
import {workflowRunner, type RunMode, type RunRecord, type ExecutableWorkflow} from '@dataflow/core';
import {evaluate} from './expressions';
import {prepareScript} from './scripts';
import {querySqlServer} from './databases/sql-server';
import {mongoDriver} from './databases/mongodb';
import {sendHttp} from './http';
import {projectRoutes, projectSecrets} from './projects';
import {describeDatabase, openDatabase} from './storage/database';
import {repository, type StoredRun} from './storage/repository';
import {storageRoutes} from './storage/routes';
import {backupWorkspace} from './storage/backup';

/*
 * Workflow runner (see docs/architecture.md).
 * For now: runs on demand and stores projects, flows and runs in Postgres (storage/database.ts). Blob storage,
 * authentication and scheduling come in the next phases.
 */

// RUNNER_PORT, not PORT: whatever starts alongside it (concurrently, preview) usually passes PORT to the editor
const PORT = Number(process.env.RUNNER_PORT ?? 5190);
/** how many runs the list returns */
const LISTED_RUNS = 50;
/** maximum time of a run (default 5 min); past that, it is interrupted */
const TIMEOUT_MS = Number(process.env.RUNNER_TIMEOUT_MS ?? 5 * 60_000);

/** runs in progress right now, for the Stop button */
const inProgress = new Map<string, AbortController>();

const database = await openDatabase();
const repo = repository(database);

// the local database (PGlite, without DATABASE_URL): a copy of projects and flows on every start
if (!process.env.DATABASE_URL) {
  await backupWorkspace(repo)
    .then(n => console.log(`Backup of ${n.projects} project(s) and ${n.flows} flow(s) in runner/data.local.backup.json.`))
    .catch(error => console.error('Could not write the backup:', error));
}

let stopping: Promise<void> | null = null;

/**
 * Stops cleanly: interrupts the runs and closes the database before leaving. PGlite stopped in the middle of a write
 * can leave runner/data.local unreadable, so every way out goes through here (Ctrl+C, a kill, the dev watcher).
 */
function stop(reason: string) {
  stopping ??= (async () => {
    for (const control of inProgress.values()) control.abort();
    // the database first: whoever reads the log may already be gone (a closed pipe must not stop the close)
    const closed = await database.close().then(() => null, (error: unknown) => error);
    try {
      console.log(`Runner stopped (${reason}): ${closed ? `could not close the database: ${String(closed)}` : 'database closed'}.`);
    } catch {
      // nobody reading
    }
    process.exit(0);
  })();
  return stopping;
}

process.on('SIGINT', () => void stop('SIGINT'));
process.on('SIGTERM', () => void stop('SIGTERM'));
// the dev watcher (scripts/dev-runner.mjs) asks for the stop through stdin: Windows has no signals between processes
if (process.env.RUNNER_STOP_ON_STDIN) {
  process.stdin.on('data', chunk => String(chunk).includes('stop') && void stop('stop requested'));
  // the watcher went away (killed): the runner does not stay behind with the database open
  process.stdin.on('end', () => void stop('watcher gone'));
}

type RunRequest = {
  /** id chosen by the caller (so it can cancel while it runs); without it, the runner generates one */
  id?: string;
  workflow: ExecutableWorkflow;
  mode: RunMode;
  parameters?: Record<string, string>;
  /** workflow input (webhook body); only if the Start "accepts input" */
  input?: unknown;
  /** the flow's project: picks the secrets and groups the runs */
  projectId?: string;
  /** workflows the Workflow Invoker calls, by id (for now the editor sends them along; later they come from the database) */
  workflows?: Record<string, ExecutableWorkflow>;
};

const app = new Hono().basePath('/api');

app.use(logger());

/** the editor polls it to show when the connection is lost; 503 when the database does not answer */
app.get('/health', async c => ((await repo.ping()) ? c.json({ok: true}) : c.json({ok: false, error: 'The runner lost the connection to its database.'}, 503)));

app.route('/', projectRoutes);
app.route('/', storageRoutes(repo));

app.post('/runs', async c => {
  const request = await c.req.json<RunRequest>();
  if (!request?.workflow?.nodes) return c.json({error: 'Invalid workflow.'}, 400);
  const id = request.id && !inProgress.has(request.id) ? request.id : crypto.randomUUID();
  const control = new AbortController();
  inProgress.set(id, control);
  let record: RunRecord;
  const mongo = mongoDriver();
  try {
    record = await workflowRunner(request.workflow, {
      mode: request.mode === 'execution' ? 'execution' : 'validation',
      id,
      parameterValues: request.parameters,
      input: request.input,
      workflows: request.workflows,
      evaluate,
      prepareScript,
      databases: {sqlserver: querySqlServer},
      documentStores: {mongodb: mongo.upsert},
      documentQueries: {mongodb: mongo.aggregate},
      documentDeletes: {mongodb: mongo.remove},
      http: sendHttp,
      secrets: await projectSecrets(request.projectId),
      signal: control.signal,
      timeoutMs: TIMEOUT_MS,
    });
  } finally {
    inProgress.delete(id);
    await mongo.close();
  }
  const stored: StoredRun = {...record, projectId: request.projectId, workflowId: request.workflow.id};
  // only execution runs are stored (editor test runs stay in the editor); a failure to store does not lose the result
  await repo.saveRun(stored).catch(error => console.error('Could not store the run:', error));
  return c.json(record);
});

app.post('/runs/:id/cancel', c => {
  const control = inProgress.get(c.req.param('id'));
  if (!control) return c.json({error: 'The run is not running.'}, 404);
  control.abort();
  return c.json({ok: true});
});

/** latest runs (of a project, with ?project=), without the components */
app.get('/runs', async c => c.json(await repo.listRuns(c.req.query('project'), LISTED_RUNS)));

app.get('/runs/:id', async c => {
  const record = await repo.getRun(c.req.param('id'));
  return record ? c.json(record) : c.json({error: 'Run not found.'}, 404);
});

console.log(`Workflow runner at http://localhost:${PORT}/api (${describeDatabase()})`);

export default {port: PORT, fetch: app.fetch};
