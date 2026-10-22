/*
 * Contract of the workflow engine (see docs/architecture.md).
 * This package depends on neither React nor Node: the editor uses it to validate and the runner (Bun) to execute.
 */

export type RunMode = 'validation' | 'execution'

export type WorkflowCurrentRun = {
  id: string
  mode: RunMode
  project: string
  workflow: string
  startedAt: string
  /** run that called this one (Workflow Invoker); without it, it was called from outside */
  parentId?: string
}

/** What passes from one component to another (see "The envelope" in docs/architecture.md). */
export type Envelope = {
  WORKFLOW_CURRENT_RUN: WorkflowCurrentRun
  PARAMETERS: Record<string, unknown>
  DATA: Record<string, unknown>
}

export type ParameterType = 'text' | 'number' | 'boolean'

export type WorkflowParameter = {
  name: string
  type: ParameterType
  default: string
  required?: boolean
}

export type ErrorPolicy = 'stop' | 'continue' | 'divert'

/** Workflow node as the runner receives it (no position or anything visual). */
export type ExecutableNode = {
  id: string
  type: string
  label: string
  config: Record<string, unknown>
  /** name of the key the component adds to DATA */
  outputKey?: string
  /** the output carries only this component's key (drops the rest of DATA) */
  override?: boolean
  disabled?: boolean
}

export type ExecutableEdge = {
  source: string
  sourcePort: string
  target: string
  targetPort: string
}

export type ExecutableWorkflow = {
  /** flow id (the Workflow Invoker calls another one by id) */
  id?: string
  project: string
  workflow: string
  parameters: WorkflowParameter[]
  nodes: ExecutableNode[]
  edges: ExecutableEdge[]
}

/** Expression evaluator. Lives in the runner (node:vm sandbox); the core only receives the function. */
export type EvaluateExpression = (expression: string, variables: Record<string, unknown>) => unknown

export type LogLevel = 'info' | 'warning' | 'error'

export type LogLine = {at: string; level: LogLevel; message: string}

/** A script's `process` function, ready to call (the runner transpiles and isolates it; see PrepareScript). */
export type ScriptFunction = (input: unknown) => Promise<unknown>

/**
 * Prepares a component's script (e.g. TypeScript) once per run. Lives in the runner, like the expression
 * evaluator. The globals apply to every call of process: $PARAMETERS, $SECRETS, $WORKFLOW_CURRENT_RUN and log.
 */
export type PrepareScript = (code: string, globals: {
  run: WorkflowCurrentRun
  parameters: Record<string, unknown>
  secrets: Record<string, string>
  log: (message: string) => void
}) => Promise<ScriptFunction>

/** A database query (SQL Server Query): the connection string is already resolved from the secret. */
export type SqlQuery = {
  connection: string
  sql: string
  /** values of the @parameters, sent to the database as parameters (never pasted into the text) */
  parameters: Record<string, unknown>
  timeoutMs: number
  /** run interrupted (Stop, timeout, failure in another component): cancels the query in the database */
  signal: AbortSignal
}

/**
 * Runs a read-only query and yields the rows one by one, with backpressure (the database pauses while the
 * flow does not consume). Lives in the runner (database driver); the core only receives the function, like the expression evaluator.
 */
export type QuerySql = (query: SqlQuery) => AsyncIterable<Record<string, unknown>>

export type ComponentContext = {
  run: WorkflowCurrentRun
  node: ExecutableNode
  /** compiles the component's code and returns the process function (a compile error becomes an exception) */
  prepareScript: (code: string) => Promise<ScriptFunction>
  /** evaluates a field that can be plain text or an expression, in the context of an envelope */
  fieldValue: (field: ExpressionField, doc: Envelope) => unknown
  log: (level: LogLevel, message: string) => void
  /**
   * Waits for something that is not an input (e.g. an internal signal of the component). Use it instead of a direct
   * `await`, so this wait does not count as active time. The engine already discounts waiting for inputs by itself.
   */
  wait: <T>(promise: Promise<T>) => Promise<T>
  /** Like wait, for reading an internal queue (e.g. Union reads the queue its inputs pour into). */
  waitEach: <T>(source: AsyncIterable<T>) => AsyncIterable<T>
  /**
   * How many envelopes the component is holding right now (e.g. the Lookup table, the Aggregate batch). The engine keeps
   * the peak. Pass the envelope you just stored: the engine measures some of them to estimate the size.
   */
  holding: (envelopes: number, held?: Envelope) => void
  /**
   * Runs another workflow (Workflow Invoker) with the values of its Start parameters and, optionally, an input.
   * `envelopes` yields the DATA of each envelope that reaches its End, as it arrives; `result` is its record.
   * A caller that stops reading before the end calls `cancel`.
   */
  invokeWorkflow: (workflowId: string, call: {parameters: Record<string, string>; input?: unknown}) => {
    envelopes: AsyncIterable<Record<string, unknown>>
    result: Promise<RunRecord>
    cancel: () => void
  }
  /** SQL Server query (the name of the secret holding the connection string becomes the connection string here) */
  querySql: (query: Omit<SqlQuery, 'connection' | 'signal'> & {secret: string}) => AsyncIterable<Record<string, unknown>>
}

/** Configuration field that can be plain text or an expression (the field's "=" button). */
export type ExpressionField = {value: string; expression: boolean}

/** What execute yields: an envelope on a port, or an error tied to the envelope that failed. */
export type ComponentOutput =
  | {port: string; doc: Envelope}
  | {error: Error; doc: Envelope}

export type Issue = string

/**
 * Type of a port. `envelope`: many envelopes in sequence (the default);
 * `text`, `number`, `json` (object or array, a single value); `any`: wildcard, connects to everything.
 */
export type PortType = 'envelope' | 'text' | 'number' | 'json' | 'any'

export type ComponentLogic = {
  type: string
  /** type of each port, in order (in-0, in-1...) */
  inputs: PortType[]
  /** type of each port, in order (out-0, out-1...); the error port is always `envelope` */
  outputs: PortType[]
  /** outputs that may stay unconnected: what goes out through them is dropped silently (e.g. Filter's false, Router's else) */
  optionalOutputs?: string[] | ((config: Record<string, unknown>) => string[])
  /**
   * Number of inputs chosen on the node (e.g. Union, 2 to 100), stored in config[key].
   * All inputs have the type of `inputs[0]`.
   */
  variableInputs?: {min: number; max: number; key: string}
  /** Number of outputs chosen on the node (e.g. Copy, 2 to 10), stored in config[key]; all of the type of `outputs[0]`. */
  variableOutputs?: {min: number; max: number; key: string}
  /**
   * Default DATA key where the component puts what it produces (the node can change it).
   * Without it, the component writes directly into the DATA fields (e.g. Mapper).
   */
  defaultOutputKey?: string
  /** configuration issues (no data): short messages, without the component's name */
  validate: (config: Record<string, unknown>) => Issue[]
  /** envelope by envelope */
  execute: (inputs: Record<string, AsyncIterable<Envelope>>, config: Record<string, unknown>, ctx: ComponentContext) => AsyncIterable<ComponentOutput>
}

// ---------- run record ----------

export type RunStatus = 'completed' | 'with-warnings' | 'with-errors' | 'failed'

export type ComponentRun = {
  nodeId: string
  label: string
  type: string
  /**
   * disabled = bypass (did not execute, only passed through); with-warnings = ran, but something deserves attention
   * (e.g. envelopes dropped by an unconnected output, nothing reached the End)
   */
  status: 'not-run' | 'completed' | 'disabled' | 'with-warnings' | 'with-errors' | 'failed'
  start?: string
  end?: string
  durationMs?: number
  /**
   * Time the component spent processing, not counting the wait for envelopes nor for the next component.
   * Since everything runs on a single thread, it is practically its CPU. Includes what the script awaits inside (e.g. an HTTP call).
   */
  activeTimeMs?: number
  /** workflows the component called (Workflow Invoker): a summary of each run, up to 50 */
  subRuns?: {id: string; workflow: string; status: RunStatus; durationMs: number; error?: string}[]
  /** What the component held at once (only accumulators: Lookup, Aggregate). Bytes estimated from the DATA JSON. */
  memory?: {peakEnvelopes: number; peakBytes: number}
  /** envelopes per port */
  inputs: Record<string, number>
  outputs: Record<string, number>
  logs: LogLine[]
  /** only the DATA of the first envelopes */
  inputSample: Record<string, unknown>[]
  outputSample: Record<string, Record<string, unknown>[]>
}

export type RunRecord = {
  run: WorkflowCurrentRun
  parameters: Record<string, unknown>
  status: RunStatus
  end: string
  durationMs: number
  error?: string
  components: ComponentRun[]
}
