import type {Envelope} from '#types/envelope.type';
import type {EvaluateExpression} from '#types/evaluate-expression.type';
import type {ExecutableWorkflow} from '#types/executable-workflow.type';
import type {PrepareScript} from '#types/prepare-script.type';
import type {DatabaseKind} from '#types/database-kind.type';
import type {QueryDatabase} from '#types/query-database.type';
import type {RunMode} from '#types/run-mode.type';
import type {DocumentStoreKind} from '#types/document-store-kind.type';
import type {UpsertDocuments} from '#types/upsert-documents.type';
import type {AggregateDocuments} from '#types/aggregate-documents.type';

export type RunOptions = {
  mode: RunMode;
  id: string;
  /** values passed by the trigger (whatever is missing uses the workflow default) */
  parameterValues?: Record<string, string>;
  /**
   * Workflow input (e.g. a webhook body). Only valid if the Start is marked as "accepts input".
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
  /** workflows the Workflow Invoker can call, by id */
  workflows?: Record<string, ExecutableWorkflow>;
  /** run that called this one (filled in by the Workflow Invoker) */
  parentId?: string;
  /** ids of the workflows in the call chain so far, to catch circular calls */
  chain?: string[];
  /** each envelope that reaches the End (the Workflow Invoker uses it to pass them on); the End awaits the promise */
  onReachEnd?: (doc: Envelope) => Promise<void>;
  secrets?: Record<string, string>;
  /** to cancel from outside (Stop button) */
  signal?: AbortSignal;
  /** maximum run time; past that, the run is interrupted */
  timeoutMs?: number;
};
