import { eq } from 'drizzle-orm';
import {
  applyRunFrom,
  flowRunner,
  type RunFromPlan,
  startConfig,
  START,
  toExecutableFlow,
  type ConnectionProfileData,
  type ExecutableFlow,
  type FlowFile,
  type OAuthTokenSource,
  type QueueFlow,
  type RunMode,
  type RunProgress,
  type RunRecord,
  type SendHttp,
} from '@dataflow/core';
import { ConnectionRepository } from '#features/connections/connection-store';
import { projects } from '#features/projects/project';
import { scriptBlobs } from '#features/scripts/script-store';
import { projectSecrets } from '#features/secrets/secret-store';
import { VariableRepository } from '#features/variables/variable-repository';
import type { Keyring } from '#shared/crypto/keyring';
import type { Database } from '#shared/database/database';
import { createEvaluate } from '#shared/runner/evaluate';
import { prepareScript } from '#shared/runner/prepare-script';
import { querySqlServer } from '#shared/runner/sqlserver-driver';
import { aggregateMongoDb, deleteMongoDb, upsertMongoDb } from '#shared/runner/mongodb-driver';
import { sendHttp } from '#shared/runner/send-http';
import type { Run } from './run';
import type { CallChain } from './run-queue';
import type { CalledFlow } from './start-run/called-flows';

/** the code of scripts by hash, kept in the supervisor (a hash is one code forever): the latest few MB */
const blobCache = new Map<string, string>();
const BLOB_CACHE_BYTES = 64 * 1024 * 1024;
let blobCacheBytes = 0;

const remember = (hash: string, content: string) => {
  blobCache.set(hash, content);
  blobCacheBytes += content.length;
  for (const [old, value] of blobCache) {
    if (blobCacheBytes <= BLOB_CACHE_BYTES) break;
    blobCache.delete(old);
    blobCacheBytes -= value.length;
  }
};

/** a run's scripts ({path: hash}) with their code: from the cache, the rest from script_blobs */
async function scriptsOfRun(db: Database, orgId: string, hashes: Record<string, string>) {
  const missing = Object.values(hashes).filter(hash => !blobCache.has(hash));
  for (const [hash, content] of await scriptBlobs(db, orgId, [...new Set(missing)])) remember(hash, content);
  const scripts: Record<string, string> = {};
  for (const [path, hash] of Object.entries(hashes)) {
    const content = blobCache.get(hash);
    if (content === undefined) throw new Error(`The script ${path} of this run is gone.`);
    // used now: the latest in the cache
    blobCache.delete(hash);
    blobCache.set(hash, content);
    scripts[path] = content;
  }
  return { scripts, scriptHashes: hashes };
}

/** the longest a run may take before the engine stops it */
export const RUN_TIMEOUT_MS = 10 * 60_000;

/**
 * Everything a worker needs to run one flow, and nothing else: it never reads the database. The supervisor prepares
 * it (secrets decrypted there) and hands it to the worker, which keeps it in memory for that run only. Plain data:
 * it crosses to the worker process as JSON.
 */
export type RunJob = {
  id: string;
  mode: RunMode;
  flow: ExecutableFlow;
  parameters: Record<string, string>;
  input?: unknown;
  secrets: Record<string, string>;
  variables: Record<string, string>;
  connections: Record<string, ConnectionProfileData>;
  /** Run from here: the component it starts from and what reached it in the last run */
  runFrom?: RunFromPlan;
  /** the flows its Flow Invokers may call, by id (each one's Start input type with it) */
  flows?: Record<string, ExecutableFlow>;
  /** a run a fire and forget call queued: the flows called down to it, and the first one's name (circular calls, depth) */
  chain?: string[];
  rootName?: string;
  /** the most runs one Flow Invoker fires and forgets in this run: 4 × the workers of the supervisor that runs it */
  maxFireAndForgetRuns?: number;
  /** the scripts its TypeScript components import, as they were when queued: {path: code} and {path: hash} */
  scripts?: Record<string, string>;
  scriptHashes?: Record<string, string>;
  /** for the record of a run that fails before the engine starts */
  projectName: string;
  flowName: string;
};

/** A failed run's record, for a failure before or around the engine (a secret that does not decrypt, a lost worker). */
export function failedRecord(run: { id: string; mode: RunMode; projectName: string; flowName: string; startedAt?: Date }, error: string): RunRecord {
  const started = run.startedAt ?? new Date();
  return {
    run: { id: run.id, mode: run.mode, project: run.projectName, flow: run.flowName, startedAt: started.toISOString() },
    parameters: {},
    status: 'failed',
    end: new Date().toISOString(),
    durationMs: Date.now() - started.getTime(),
    error,
    components: [],
  };
}

/** A run stopped from outside: what it did so far (its last progress), the components it had not finished as they were. */
export function stoppedRecord(progress: RunProgress | null, run: Parameters<typeof failedRecord>[0], error: string): RunRecord {
  if (!progress) {
    return failedRecord(run, error);
  }

  return { ...progress, status: 'failed', end: new Date().toISOString(), error };
}

/**
 * Reads what a claimed run needs: the flow it queued, the project's secrets (decrypted here, in memory), connection
 * profiles and variables, and the Start's test input when the Start accepts one. Throws when something is missing or
 * wrong (then the run fails with that message).
 */
export async function prepareJob(db: Database, keyring: Keyring | undefined, run: Run): Promise<RunJob> {
  const file = run.definition as FlowFile | null;
  if (!file || !run.projectId) {
    throw new Error('The run has no flow to run.');
  }

  const [project] = await db.orm.select({ name: projects.name }).from(projects).where(eq(projects.id, run.projectId));
  const [secretRows, connectionRows, variableRows] = await Promise.all([
    projectSecrets(db, run.orgId, run.projectId),
    new ConnectionRepository(db, run.orgId).ofProject(run.projectId),
    new VariableRepository(db, run.orgId).ofProject(run.projectId),
  ]);

  const secrets: Record<string, string> = {};
  if (secretRows.length > 0 && !keyring) {
    throw new Error('The server has no keyring: the project secrets cannot be read.');
  }

  for (const secret of secretRows) {
    secrets[secret.name] = await keyring!.decrypt(secret, secret.id, secret.name);
  }

  const { acceptsInput, testInput } = startConfig(file.nodes.find(n => n.type === START)?.config ?? {});
  const input = run.input ?? (acceptsInput && testInput.trim() ? JSON.parse(testInput) : undefined);
  const projectName = project?.name ?? '';
  const whole = { ...toExecutableFlow(file, projectName), id: run.flowId };
  // Run from here: the component and what follows it, fed with what reached it in the last run
  const from = run.runFrom as RunFromPlan | null;
  // the called flows, as they were when queued: one that cannot be called still names itself (each call is an error)
  const flows = Object.fromEntries(
    ((run.calledFlows as CalledFlow[] | null) ?? []).map((c): [string, ExecutableFlow] => [
      c.id,
      {
        ...(c.flow ? toExecutableFlow(c.flow, projectName) : { project: projectName, flow: c.name, parameters: [], nodes: [], edges: [] }),
        id: c.id,
        ...(c.inputType ? { inputType: c.inputType } : {}),
        ...(c.unavailable ? { unavailable: c.unavailable } : {}),
      },
    ]),
  );
  const chain = run.callChain as CallChain | null;
  return {
    id: run.id,
    mode: run.mode,
    flow: from ? applyRunFrom(whole, from) : whole,
    ...(from ? { runFrom: from } : {}),
    ...(Object.keys(flows).length ? { flows } : {}),
    ...(chain ? { chain: chain.flows, rootName: chain.rootName } : {}),
    ...(await scriptsOfRun(db, run.orgId, (run.scripts as Record<string, string> | null) ?? {})),
    parameters: (run.parameters as Record<string, string> | null) ?? {},
    input,
    secrets,
    variables: Object.fromEntries(variableRows.map(v => [v.name, v.value])),
    connections: Object.fromEntries(connectionRows.map(c => [c.id, { name: c.name, type: c.type, config: c.config }])),
    projectName,
    flowName: file.name,
  };
}

/**
 * Runs a prepared job with the engine (in a worker). The engine hides the secrets' values in the logs, the errors
 * and the record. `onProgress`: the run so far, a few times a second; `signal`: Stop; `oauthTokens`: where the OAuth 2.0
 * tokens come from (a worker: its supervisor); `queueFlow`: where a fire and forget call is queued (its supervisor).
 */
export async function runJob(
  job: RunJob,
  options: { http?: SendHttp; onProgress?: (progress: RunProgress) => void; signal?: AbortSignal; oauthTokens?: OAuthTokenSource; queueFlow?: QueueFlow } = {},
): Promise<RunRecord> {
  try {
    return await flowRunner(job.flow, {
      mode: job.mode,
      id: job.id,
      parameterValues: job.parameters,
      // one expression context for the whole run (and the flows it calls), never shared with another run
      evaluate: createEvaluate(),
      http: options.http ?? sendHttp,
      // the databases' drivers (SQL Server Query; MongoDB Pipeline, Upsert, Delete): in a test run, what writes does
      // not reach them (the engine's gate), a Delete only counts
      databases: { sqlserver: querySqlServer },
      documentQueries: { mongodb: aggregateMongoDb },
      documentStores: { mongodb: upsertMongoDb },
      documentDeletes: { mongodb: deleteMongoDb },
      secrets: job.secrets,
      variables: job.variables,
      connections: job.connections,
      input: job.input,
      timeoutMs: RUN_TIMEOUT_MS,
      onProgress: options.onProgress,
      runFrom: job.runFrom,
      flows: job.flows,
      ...(job.chain ? { chain: job.chain, rootName: job.rootName } : {}),
      ...(job.maxFireAndForgetRuns !== undefined ? { maxFireAndForgetRuns: job.maxFireAndForgetRuns } : {}),
      ...(options.queueFlow ? { queueFlow: options.queueFlow } : {}),
      prepareScript: (code, globals) => prepareScript(code, globals, job.scripts ?? {}, job.scriptHashes ?? {}),
      signal: options.signal,
      // a worker's OAuth 2.0 tokens come from its supervisor; elsewhere (tests) from this process's memory
      ...(options.oauthTokens ? { oauthTokens: options.oauthTokens } : {}),
    });
  } catch (e) {
    // the engine masks what it writes; an error thrown past it is masked here
    const message = Object.values(job.secrets)
      .filter(value => value.length > 0)
      .reduce((text, value) => text.split(value).join('***'), e instanceof Error ? e.message : String(e));
    return failedRecord({ ...job }, message);
  }
}
