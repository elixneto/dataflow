import type {Envelope} from '#types/envelope.type';
import type {ExecutableNode} from '#types/executable-node.type';
import type {ExpressionField} from '#types/expression-field.type';
import type {LogLevel} from '#types/log-level.type';
import type {RunRecord} from '#types/run-record.type';
import type {ScriptFunction} from '#types/script-function.type';
import type {DatabaseKind} from '#types/database-kind.type';
import type {DatabaseQuery} from '#types/database-query.type';
import type {WorkflowCurrentRun} from '#types/workflow-current-run.type';
import type {EnvelopeData} from '#types/envelope-data.type';

export type ComponentContext = {
  run: WorkflowCurrentRun;
  node: ExecutableNode;
  /** compiles the component's code and returns the process function (a compile error becomes an exception) */
  prepareScript: (code: string) => Promise<ScriptFunction>;
  /** evaluates a field that can be plain text or an expression, in the context of an envelope */
  fieldValue: (field: ExpressionField, doc: Envelope) => unknown;
  log: (level: LogLevel, message: string) => void;
  /**
   * Waits for something that is not an input (e.g. an internal signal of the component). Use it instead of a direct
   * `await`, so this wait does not count as active time. The engine already discounts waiting for inputs by itself.
   */
  wait: <T>(promise: Promise<T>) => Promise<T>;
  /** Like wait, for reading an internal queue (e.g. Union reads the queue its inputs pour into). */
  waitEach: <T>(source: AsyncIterable<T>) => AsyncIterable<T>;
  /**
   * How many envelopes the component is holding right now (e.g. the Lookup table, the Aggregate batch). The engine keeps
   * the peak. Pass the envelope you just stored: the engine measures some of them to estimate the size.
   */
  holding: (envelopes: number, held?: Envelope) => void;
  /**
   * Runs another workflow (Workflow Invoker) with the values of its Start parameters and, optionally, an input.
   * `envelopes` yields the DATA of each envelope that reaches its End, as it arrives; `result` is its record.
   * A caller that stops reading before the end calls `cancel`.
   */
  invokeWorkflow: (workflowId: string, call: {parameters: Record<string, string>; input?: unknown}) => {
    envelopes: AsyncIterable<EnvelopeData>;
    result: Promise<RunRecord>;
    cancel: () => void;
  };
  /**
   * Query on a database, through the driver the runner registered for that kind. The name of the secret holding the
   * connection string becomes the connection string here; the run's signal cancels the query.
   */
  queryDatabase: (kind: DatabaseKind, query: Omit<DatabaseQuery, 'connection' | 'signal'> & {secret: string}) => AsyncIterable<Record<string, unknown>>;
};
