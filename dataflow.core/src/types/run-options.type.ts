import type {RunProgress} from '#types/run-record.type';
import type {RunFromPlan} from '#engine/run-from';
import type {ConnectionProfileData} from '../connections/connection-access';
import type {OAuthTokenSource} from '../connections/oauth-token-cache';
import type {Envelope} from '#types/envelope.type';
import type {EvaluateExpression} from '#types/evaluate-expression.type';
import type {ExecutableFlow} from '#types/executable-flow.type';
import type {PrepareScript} from '#types/prepare-script.type';
import type {DatabaseKind} from '#types/database-kind.type';
import type {QueryDatabase} from '#types/query-database.type';
import type {RunMode} from '#types/run-mode.type';
import type {DocumentStoreKind} from '#types/document-store-kind.type';
import type {UpsertDocuments} from '#types/upsert-documents.type';
import type {AggregateDocuments} from '#types/aggregate-documents.type';
import type {DeleteDocuments} from '#types/delete-documents.type';
import type {SendHttp} from '#types/send-http.type';
import type {QueueFlow} from '#types/queue-flow.type';

export type RunOptions = {
  mode: RunMode;
  id: string;
  /** values passed by the trigger (whatever is missing uses the flow default) */
  parameterValues?: Record<string, string>;
  /**
   * Flow input (e.g. a webhook body). Only valid if the Start is marked as "accepts input".
   * An object becomes the DATA fields; an array becomes one envelope per item; any other value becomes DATA.input.
   */
  input?: unknown;
  evaluate: EvaluateExpression;
  /** compiles and isolates scripts (TypeScript component); without it, the component fails */
  prepareScript?: PrepareScript;
  /** database drivers, by kind; a component querying a kind without a driver fails */
  databases?: Partial<Record<DatabaseKind, QueryDatabase>>;
  /** document database drivers that write (upserts), by kind; a component writing to a kind without a driver fails */
  documentStores?: Partial<Record<DocumentStoreKind, UpsertDocuments>>;
  /** document database drivers that read (aggregation pipelines), by kind */
  documentQueries?: Partial<Record<DocumentStoreKind, AggregateDocuments>>;
  /** document database drivers that delete, by kind */
  documentDeletes?: Partial<Record<DocumentStoreKind, DeleteDocuments>>;
  /** sends HTTP requests (HTTP Request component); without it, the component fails */
  http?: SendHttp;
  /** flows the Flow Invoker can call, by id */
  flows?: Record<string, ExecutableFlow>;
  /**
   * a Flow Invoker's fire and forget call in a real run: queues the called flow as a run of its own (its id back);
   * without it, such a call is an error of the envelope. A test run never queues: the call runs beside the run.
   */
  queueFlow?: QueueFlow;
  /**
   * The most runs one Flow Invoker fires and forgets in this run (its batches): past it, the batches left grow instead
   * of making more runs. The server sets it from its workers (4 × WORKERS); without it, no limit.
   */
  maxFireAndForgetRuns?: number;
  /** run that called this one (filled in by the Flow Invoker) */
  parentId?: string;
  /** ids of the flows in the call chain so far, to catch circular calls; `rootName`: the first one's name, for the message */
  chain?: string[];
  rootName?: string;
  /** each envelope that reaches the End (the Flow Invoker uses it to pass them on); the End awaits the promise */
  onReachEnd?: (doc: Envelope) => Promise<void>;
  secrets?: Record<string, string>;
  /**
   * the run as it goes, a few times a second: each component's status (running, then how it ended), counts, samples
   * and logs so far (what the editor shows live). A copy: changing it changes nothing in the run.
   */
  onProgress?: (progress: RunProgress) => void;
  /** the project's variables (plain values, not masked): $VARIABLES */
  variables?: Record<string, string>;
  /** the project's connection profiles, by id (their secret fields name entries of `secrets`) */
  connections?: Record<string, ConnectionProfileData>;
  /**
   * where the OAuth 2.0 tokens of the run's API connections come from (and a refused one goes back): by default the
   * memory of the run's own process (oauth-token-cache.ts); a worker's runs ask their supervisor
   */
  oauthTokens?: OAuthTokenSource;
  /**
   * Run from here: the run is the component and what follows it (applyRunFrom), and these envelopes go into its inputs
   * (the record says so; its first log line too)
   */
  runFrom?: RunFromPlan;
  /** to cancel from outside (Stop button) */
  signal?: AbortSignal;
  /** maximum run time; past that, the run is interrupted */
  timeoutMs?: number;
};
