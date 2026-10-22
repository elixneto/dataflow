import {Channel, empty} from './channel'
import {COMPONENTS} from './components'
import {findCycle, envelopeVariables} from './envelope'
import type {
  EvaluateExpression,
  QuerySql,
  ComponentContext,
  Envelope,
  ComponentRun,
  RunMode,
  ExecutableNode,
  ErrorPolicy,
  PrepareScript,
  RunRecord,
  WorkflowCurrentRun,
  ExecutableWorkflow,
} from './types'

export const START = 'start'
export const END = 'end'

/** Copy of the sample (the envelope moves on and may be changed by another component). */
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T

/** How many envelopes to keep per port in the run sample. */
const SAMPLE_SIZE = 20

export type RunOptions = {
  mode: RunMode
  id: string
  /** values passed by the trigger (whatever is missing uses the workflow default) */
  parameterValues?: Record<string, string>
  /**
   * Workflow input (e.g. a webhook body). Only valid if the Start is marked as "accepts input".
   * An object becomes the DATA fields; an array becomes one envelope per item; any other value becomes DATA.input.
   */
  input?: unknown
  evaluate: EvaluateExpression
  /** compiles and isolates scripts (TypeScript component); without it, the component fails */
  prepareScript?: PrepareScript
  /** runs queries on SQL Server; without it, the component fails */
  querySql?: QuerySql
  /** workflows the Workflow Invoker can call, by id */
  workflows?: Record<string, ExecutableWorkflow>
  /** run that called this one (filled in by the Workflow Invoker) */
  parentId?: string
  /** ids of the workflows in the call chain so far, to catch circular calls */
  chain?: string[]
  /** each envelope that reaches the End (the Workflow Invoker uses it to pass them on); the End awaits the promise */
  onReachEnd?: (doc: Envelope) => Promise<void>
  secrets?: Record<string, string>
  /** to cancel from outside (Stop button) */
  signal?: AbortSignal
  /** maximum run time; past that, the run is interrupted */
  timeoutMs?: number
}

class RunInterrupted extends Error {}

/** How many workflows can call each other in sequence (A calls B which calls C...). */
export const MAX_WORKFLOW_DEPTH = 10
/** How many sub-runs to keep in the component's record. */
const MAX_SUB_RUNS = 50

/**
 * Active time of a component: starts when its code runs again (the engine asked for the next result, an envelope
 * arrived) and stops when it is waiting (input, next component, ctx.wait). Since there is a single thread,
 * the sum is practically the component's CPU.
 */
class Stopwatch {
  total = 0
  private since?: number

  get running() { return this.since !== undefined }

  resume() {
    this.since ??= performance.now()
  }

  stop() {
    if (this.since === undefined) return
    this.total += performance.now() - this.since
    this.since = undefined
  }
}

/** How many envelopes to measure at the start to estimate the size; after that, one every MEASURE_INTERVAL. */
const INITIAL_MEASURES = 50
const MEASURE_INTERVAL = 100

/** Peak of what the component held (ctx.holding). Bytes = peak × average size of the DATA JSON (sampled). */
class Memory {
  peak = 0
  private calls = 0
  private measured = 0
  private measuredBytes = 0

  holding(envelopes: number, held?: Envelope) {
    this.peak = Math.max(this.peak, envelopes)
    if (!held) return
    this.calls += 1
    if (this.measured >= INITIAL_MEASURES && this.calls % MEASURE_INTERVAL !== 0) return
    try {
      this.measuredBytes += JSON.stringify(held.DATA)?.length ?? 0
      this.measured += 1
    } catch { /* DATA that cannot become JSON (e.g. BigInt): left unmeasured */ }
  }

  get summary(): ComponentRun['memory'] {
    if (this.peak === 0) return undefined
    const average = this.measured ? this.measuredBytes / this.measured : 0
    return {peakEnvelopes: this.peak, peakBytes: Math.round(this.peak * average)}
  }
}

/** Reads a source starting the stopwatch on each item and stopping it while waiting for the next. */
async function* timed<T>(source: AsyncIterable<T>, stopwatch: Stopwatch): AsyncIterable<T> {
  const it = source[Symbol.asyncIterator]()
  try {
    while (true) {
      stopwatch.stop()
      const r = await it.next()
      if (r.done) return
      stopwatch.resume()
      yield r.value
    }
  } finally {
    await it.return?.()
  }
}

const STATUS_LABEL: Record<RunRecord['status'], string> = {
  completed: 'completed', 'with-warnings': 'with warnings', 'with-errors': 'with errors', failed: 'failed',
}

/**
 * Envelope that goes out through the error port: gets DATA.errors.
 * It is a list: if the same envelope fails in more than one component, the errors accumulate.
 */
function withError(doc: Envelope, error: Error, component: string): Envelope {
  const previous = Array.isArray(doc.DATA.errors) ? doc.DATA.errors : []
  return {...doc, DATA: {...doc.DATA, errors: [...previous, {error: error.name || 'Error', message: error.message, component}]}}
}

function policy(node: ExecutableNode): ErrorPolicy {
  const v = node.config.onError
  return v === 'continue' || v === 'divert' ? v : 'stop'
}

function convert(value: string, type: string): unknown {
  if (type === 'number') return Number(value)
  if (type === 'boolean') return value === 'true'
  return value
}

/** Resolves the parameters: trigger value, otherwise the default; a required one without a value prevents the run. */
export function resolveParameters(wf: ExecutableWorkflow, values: Record<string, string> = {}) {
  const parameters: Record<string, unknown> = {}
  const missing: string[] = []
  for (const p of wf.parameters) {
    const value = values[p.name] ?? p.default
    if (p.required && (value === undefined || value === '')) missing.push(p.name)
    parameters[p.name] = convert(value ?? '', p.type)
  }
  return {parameters, missing}
}

/**
 * Flow order (Start → ... → End), so the record lists the components in the order the envelopes pass through.
 * Components run at the same time, so the start time is useless: in a fast flow they all start in the same ms.
 * Kahn over the edges; ties by node order; whatever is not connected goes to the end.
 */
export function flowOrder(wf: ExecutableWorkflow): string[] {
  const degree = new Map(wf.nodes.map(n => [n.id, 0]))
  for (const e of wf.edges) degree.set(e.target, (degree.get(e.target) ?? 0) + 1)
  const connected = new Set(wf.edges.flatMap(e => [e.source, e.target]))
  const queue = wf.nodes.filter(n => degree.get(n.id) === 0 && (connected.has(n.id) || n.type === START)).map(n => n.id)
  const order: string[] = []
  while (queue.length) {
    const current = queue.shift()!
    order.push(current)
    for (const e of wf.edges.filter(x => x.source === current)) {
      const d = (degree.get(e.target) ?? 0) - 1
      degree.set(e.target, d)
      if (d === 0) queue.push(e.target)
    }
  }
  // End last when it receives from several branches; cycles and loose nodes at the end, in node order
  const rest = wf.nodes.map(n => n.id).filter(id => !order.includes(id))
  const withoutEnd = order.filter(id => wf.nodes.find(n => n.id === id)?.type !== END)
  const ends = order.filter(id => wf.nodes.find(n => n.id === id)?.type === END)
  return [...withoutEnd, ...ends, ...rest]
}

/**
 * Runs the workflow envelope by envelope: each edge becomes a Channel and all
 * components run at the same time. Returns the record with start, end, counts, logs and samples per component.
 */
export async function runWorkflow(wf: ExecutableWorkflow, options: RunOptions): Promise<RunRecord> {
  const start = Date.now()
  const run: WorkflowCurrentRun = {
    id: options.id, mode: options.mode, project: wf.project, workflow: wf.workflow, startedAt: new Date(start).toISOString(),
    ...(options.parentId ? {parentId: options.parentId} : {}),
  }
  const {parameters, missing} = resolveParameters(wf, options.parameterValues)

  const records = new Map<string, ComponentRun>(wf.nodes.map(node => [node.id, {
    nodeId: node.id, label: node.label, type: node.type, status: 'not-run',
    inputs: {}, outputs: {}, logs: [], inputSample: [], outputSample: {},
  }]))
  const stopwatches = new Map(wf.nodes.map(node => [node.id, new Stopwatch()]))
  const memories = new Map(wf.nodes.map(node => [node.id, new Memory()]))

  const finish = (status: RunRecord['status'], error?: string): RunRecord => {
    const durationMs = Date.now() - start
    // closes the log at the End, the pair of the Start's "started"
    const endRecord = records.get(wf.nodes.find(n => n.type === END)?.id ?? '')
    endRecord?.logs.push({
      at: new Date().toISOString(),
      level: status === 'failed' ? 'error' : status === 'completed' ? 'info' : 'warning',
      message: `Run ${run.id} finished (${STATUS_LABEL[status]}) in ${durationMs} ms.`,
    })
    return {run, parameters, status, error, end: new Date().toISOString(), durationMs, components: flowOrder(wf).map(id => records.get(id)!)}
  }

  if (missing.length) return finish('failed', `Required parameter without a value: ${missing.join(', ')}.`)

  const cycle = findCycle(wf.nodes.map(n => n.id), wf.edges)
  if (cycle) {
    const name = (id: string) => wf.nodes.find(n => n.id === id)?.label ?? id
    return finish('failed', `The flow has a cycle (infinite loop): ${cycle.map(name).join(' → ')}.`)
  }

  const startNode = wf.nodes.find(n => n.type === START)
  const startAcceptsInput = startNode?.config.acceptsInput === true
  if (options.input !== undefined && !startAcceptsInput) {
    return finish('failed', 'The Start of this workflow does not accept input. Check "Accepts input" on the Start or call it without a body.')
  }
  // array: one envelope per item (envelope by envelope); object: the fields become DATA; any other value: DATA.input
  const toEnvelope = (v: unknown): Record<string, unknown> =>
    v !== null && typeof v === 'object' && !Array.isArray(v) ? {...(v as Record<string, unknown>)} : {input: v}
  const initialEnvelopes: Record<string, unknown>[] = options.input === undefined ? [{}]
    : Array.isArray(options.input) ? options.input.map(toEnvelope)
      : [toEnvelope(options.input)]

  // one channel per edge
  const channels = wf.edges.map(e => ({...e, channel: new Channel<Envelope>()}))
  /** Sources of each node input. Several edges into the same input (e.g. End) become one, in arrival order. */
  const inputsOf = (nodeId: string) => {
    const perPort: Record<string, AsyncIterable<Envelope>[]> = {}
    for (const e of channels.filter(c => c.target === nodeId)) (perPort[e.targetPort] ??= []).push(e.channel)
    return Object.fromEntries(Object.entries(perPort).map(([port, sources]) => [port, sources.length === 1 ? sources[0] : merge(sources)]))
  }
  const outputsOf = (nodeId: string, port: string) => channels.filter(c => c.source === nodeId && c.sourcePort === port).map(c => c.channel)
  /** tells whoever talks to the outside (e.g. a database query) that the run stopped */
  const control = new AbortController()
  const abortAll = () => {
    channels.forEach(c => c.channel.abort())
    control.abort()
  }

  let failure: string | undefined

  /** envelopes that went out through an unconnected port (they vanish from the flow): per node and port */
  const dropped = new Map<string, Record<string, number>>()

  async function send(node: ExecutableNode, port: string, doc: Envelope) {
    const rec = records.get(node.id)!
    // waiting for the next component (full queue) is not active time
    const stopwatch = stopwatches.get(node.id)!
    const wasRunning = stopwatch.running
    stopwatch.stop()
    rec.outputs[port] = (rec.outputs[port] ?? 0) + 1
    if (outputsOf(node.id, port).length === 0) {
      const perPort = dropped.get(node.id) ?? {}
      perPort[port] = (perPort[port] ?? 0) + 1
      dropped.set(node.id, perPort)
    }
    const sample = (rec.outputSample[port] ??= [])
    if (sample.length < SAMPLE_SIZE) sample.push(clone(doc.DATA))
    for (const channel of outputsOf(node.id, port)) await channel.send(doc)
    if (wasRunning) stopwatch.resume()
  }

  /**
   * Counts and samples what comes in, and marks the start on the first envelope. The component's stopwatch stops while
   * it waits for the next envelope and resumes when the envelope is delivered.
   */
  async function* watchInput(node: ExecutableNode, port: string, source: AsyncIterable<Envelope>) {
    const rec = records.get(node.id)!
    const stopwatch = stopwatches.get(node.id)!
    stopwatch.stop()
    for await (const doc of source) {
      rec.start ??= new Date().toISOString()
      rec.inputs[port] = (rec.inputs[port] ?? 0) + 1
      if (rec.inputSample.length < SAMPLE_SIZE) rec.inputSample.push(clone(doc.DATA))
      stopwatch.resume()
      yield doc
      stopwatch.stop()
    }
  }

  async function runNode(node: ExecutableNode) {
    const rec = records.get(node.id)!
    const log = (level: 'info' | 'warning' | 'error', message: string) => rec.logs.push({at: new Date().toISOString(), level, message})
    const outputPorts = [...new Set(channels.filter(c => c.source === node.id).map(c => c.sourcePort))]
    const stopwatch = stopwatches.get(node.id)!
    const t0 = Date.now()
    let errors = 0
    try {
      const inputs = Object.fromEntries(Object.entries(inputsOf(node.id)).map(([port, source]) => [port, watchInput(node, port, source)]))

      if (node.type === START) {
        rec.start = new Date().toISOString()
        stopwatch.resume()
        for (const envelope of initialEnvelopes) {
          if (options.input !== undefined) {
            rec.inputs['in-0'] = (rec.inputs['in-0'] ?? 0) + 1
            if (rec.inputSample.length < SAMPLE_SIZE) rec.inputSample.push(clone(envelope))
          }
          const doc: Envelope = {WORKFLOW_CURRENT_RUN: run, PARAMETERS: parameters, DATA: envelope}
          for (const port of outputPorts) await send(node, port, doc)
        }
        log('info', `Run ${run.id} started (${run.mode})${options.input !== undefined ? ' with input' : ''}.`)
      } else if (node.type === END) {
        for (const source of Object.values(inputs)) {
          for await (const doc of source) if (options.onReachEnd) await options.onReachEnd(doc)
        }
      } else if (node.disabled) {
        log('warning', 'Disabled (bypass): did not execute, the envelopes passed straight through.')
        for await (const doc of inputs['in-0'] ?? empty<Envelope>()) await send(node, 'out-0', doc)
      } else {
        const logic = COMPONENTS[node.type]
        if (!logic) throw new Error(`Component "${node.type}" does not exist in the runner.`)
        const ctx: ComponentContext = {
          run, node, log,
          prepareScript: async code => {
            if (!options.prepareScript) throw new Error('This runner does not execute scripts.')
            return options.prepareScript(code, {run, parameters, secrets: options.secrets ?? {}, log: m => log('info', m)})
          },
          fieldValue: (field, doc) => (field.expression
            ? options.evaluate(field.value, envelopeVariables(doc, options.secrets))
            : field.value),
          wait: async promise => {
            stopwatch.stop()
            try {
              return await promise
            } finally {
              stopwatch.resume()
            }
          },
          waitEach: source => timed(source, stopwatch),
          invokeWorkflow: (workflowId, {parameters: values, input}) => {
            const child = options.workflows?.[workflowId]
            if (!child) throw new Error(`The called workflow (${workflowId}) was not found.`)
            const chain = [...(options.chain ?? [wf.id ?? wf.workflow]), workflowId]
            if (chain.slice(0, -1).includes(workflowId)) {
              const name = (id: string) => options.workflows?.[id]?.workflow ?? (id === wf.id ? wf.workflow : id)
              throw new Error(`Circular workflow call: ${chain.map(name).join(' → ')}.`)
            }
            if (chain.length > MAX_WORKFLOW_DEPTH + 1) {
              throw new Error(`More than ${MAX_WORKFLOW_DEPTH} workflows called in sequence.`)
            }
            // the child stops when this run stops, or when the caller gives up reading
            const childControl = new AbortController()
            const cancel = () => childControl.abort()
            control.signal.addEventListener('abort', cancel)
            const queue = new Channel<Record<string, unknown>>()
            const result = runWorkflow(child, {
              ...options,
              id: crypto.randomUUID(),
              parameterValues: values,
              input,
              signal: childControl.signal,
              // the timeout is this run's (which cancels the child along with it)
              timeoutMs: undefined,
              parentId: run.id,
              chain,
              onReachEnd: doc => queue.send(doc.DATA),
            }).then(record => {
              const list = (rec.subRuns ??= [])
              if (list.length < MAX_SUB_RUNS) {
                list.push({id: record.run.id, workflow: record.run.workflow, status: record.status, durationMs: record.durationMs, ...(record.error ? {error: record.error} : {})})
              }
              return record
            }).finally(() => {
              control.signal.removeEventListener('abort', cancel)
              queue.close()
            })
            return {
              envelopes: queue,
              result,
              cancel: () => {
                cancel()
                queue.abort()
              },
            }
          },
          querySql: ({secret, ...query}) => {
            if (!options.querySql) throw new Error('This runner does not query databases.')
            const connection = options.secrets?.[secret]
            if (!connection) throw new Error(`The secret "${secret}" does not exist in this runner.`)
            return options.querySql({...query, connection, signal: control.signal})
          },
          holding: (envelopes, held) => memories.get(node.id)!.holding(envelopes, held),
        }
        // the stopwatch runs while the component produces the next result (it discounts waiting for inputs)
        for await (const output of timedRequests(logic.execute(inputs, node.config, ctx), stopwatch)) {
          if ('port' in output) {
            await send(node, output.port, output.doc)
            continue
          }
          const p = policy(node)
          // Divert = handled error: the envelope goes out through the error port and the component does not count as "with errors"
          if (p === 'divert') {
            log('warning', `Diverted to the error port: ${output.error.message}`)
            await send(node, 'error', withError(output.doc, output.error, node.label))
            continue
          }
          errors += 1
          log('error', output.error.message)
          if (p === 'stop') throw new RunInterrupted(`"${node.label}": ${output.error.message}`)
          // continue: the incoming envelope goes out as it was through the main output and the flow moves on
          if (p === 'continue') await send(node, 'out-0', output.doc)
        }
      }
      // unconnected optional output (e.g. Filter's false): dropping is expected, it does not become a warning
      const defined = COMPONENTS[node.type]?.optionalOutputs ?? []
      const optional = typeof defined === 'function' ? defined(node.config) : defined
      for (const port of optional) {
        const n = dropped.get(node.id)?.[port]
        if (!n) continue
        log('info', `${n} envelope(s) dropped by the output ${port}, which is not connected.`)
        delete dropped.get(node.id)![port]
      }
      if (dropped.get(node.id) && Object.keys(dropped.get(node.id)!).length === 0) dropped.delete(node.id)
      const lost = dropped.get(node.id)
      if (lost) {
        for (const [port, n] of Object.entries(lost)) {
          log('warning', `${n} envelope(s) dropped: the ${port === 'out-0' ? 'main' : port} output is not connected.`)
        }
      }
      rec.status = errors > 0 ? 'with-errors' : node.disabled ? 'disabled' : lost ? 'with-warnings' : 'completed'
    } catch (e) {
      rec.status = 'failed'
      const message = e instanceof Error ? e.message : String(e)
      log('error', message)
      failure ??= e instanceof RunInterrupted ? message : `"${node.label}": ${message}`
      abortAll()
    } finally {
      stopwatch.stop()
      rec.activeTimeMs = Math.round(stopwatch.total * 100) / 100
      rec.memory = memories.get(node.id)!.summary
      rec.start ??= new Date(t0).toISOString()
      rec.end = new Date().toISOString()
      rec.durationMs = Date.now() - Date.parse(rec.start)
      for (const port of outputPorts) for (const channel of outputsOf(node.id, port)) channel.close()
    }
  }

  // stopping from outside (button) or by timeout: tears down the channels and each component finishes what it was doing
  const interrupt = (reason: string) => {
    failure ??= reason
    abortAll()
  }
  const onCancel = () => interrupt('Run cancelled.')
  if (options.signal?.aborted) onCancel()
  options.signal?.addEventListener('abort', onCancel)
  const limit = options.timeoutMs
    ? setTimeout(() => interrupt(`Run interrupted: exceeded the maximum time (${Math.round(options.timeoutMs! / 1000)} s).`), options.timeoutMs)
    : undefined

  await Promise.all(wf.nodes.map(runNode))

  clearTimeout(limit)
  options.signal?.removeEventListener('abort', onCancel)

  if (failure) return finish('failed', failure)
  // nothing reached the End: the flow ran, but delivered nothing
  const end = wf.nodes.find(n => n.type === END)
  const endRecord = end && records.get(end.id)
  if (endRecord && endRecord.status === 'completed' && !endRecord.inputs['in-0']) {
    endRecord.status = 'with-warnings'
    endRecord.logs.push({at: new Date().toISOString(), level: 'warning', message: 'No envelope reached the End.'})
  }

  const status = [...records.values()].map(r => r.status)
  return finish(status.includes('with-errors') ? 'with-errors' : status.includes('with-warnings') ? 'with-warnings' : 'completed')
}

/** Starts the stopwatch on each request for the next result and stops it when the result comes out. */
async function* timedRequests<T>(source: AsyncIterable<T>, stopwatch: Stopwatch): AsyncIterable<T> {
  const it = source[Symbol.asyncIterator]()
  try {
    while (true) {
      stopwatch.resume()
      const r = await it.next()
      stopwatch.stop()
      if (r.done) return
      yield r.value
    }
  } finally {
    await it.return?.()
  }
}

/** Merges several sources into one, in the order the envelopes arrive (like Union). */
async function* merge(sources: AsyncIterable<Envelope>[]): AsyncIterable<Envelope> {
  const queue = new Channel<Envelope>()
  const pours = sources.map(async source => {
    for await (const doc of source) await queue.send(doc)
  })
  Promise.all(pours).finally(() => queue.close())
  yield* queue
  await Promise.all(pours)
}
