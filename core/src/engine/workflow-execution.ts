import {Channel, empty} from '../channel';
import {COMPONENTS} from '../components';
import {END, SAMPLE_SIZE, START} from '#engine/constants';
import {Stopwatch, timedRequests} from '#engine/stopwatch';
import {writesOutside} from '#engine/side-effects';
import {MemoryMeter} from '#engine/memory-meter';
import {flowOrder} from '#engine/flow-order';
import {errorPolicy, withError} from '#engine/error-envelope';
import {mergeSources} from '#engine/merge-sources';
import {componentContext} from '#engine/component-context';
import {RunInterrupted} from '#errors/run-interrupted';
import type {ComponentRun} from '#types/component-run.type';
import type {Envelope} from '#types/envelope.type';
import type {EnvelopeData} from '#types/envelope-data.type';
import type {ExecutableNode} from '#types/executable-node.type';
import type {ExecutableWorkflow} from '#types/executable-workflow.type';
import type {LogLevel} from '#types/log-level.type';
import type {ParameterValue} from '#types/parameter.type';
import type {RunOptions} from '#types/run-options.type';
import type {RunRecord} from '#types/run-record.type';
import type {WorkflowCurrentRun} from '#types/workflow-current-run.type';

async function drain(source: AsyncIterable<Envelope>) {
  for await (const _ of source) { /* dropped */ }
}

/** Copy of the sample (the envelope moves on and may be changed by another component). */
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

const STATUS_LABEL: Record<RunRecord['status'], string> = {
  completed: 'completed', 'with-warnings': 'with warnings', 'with-errors': 'with errors', failed: 'failed',
};

/**
 * One run of a workflow, envelope by envelope: each edge becomes a Channel and all components run at the same time.
 * Holds the run's state (records, stopwatches, memory, channels) and builds the record at the end.
 */
export class WorkflowExecution {
  readonly run: WorkflowCurrentRun;
  /** tells whoever talks to the outside (e.g. a database query, a called workflow) that the run stopped */
  readonly control = new AbortController();

  private readonly start = Date.now();
  private readonly records: Map<string, ComponentRun>;
  private readonly stopwatches: Map<string, Stopwatch>;
  private readonly memories: Map<string, MemoryMeter>;
  private readonly waits: Map<string, Stopwatch>;
  private readonly channels: (ExecutableWorkflow['edges'][number] & {channel: Channel<Envelope>})[];
  /** envelopes that went out through an unconnected port (they vanish from the flow): per node and port */
  private readonly dropped = new Map<string, Record<string, number>>();
  private initialEnvelopes: EnvelopeData[] = [];
  private failure?: string;

  constructor(readonly wf: ExecutableWorkflow, readonly options: RunOptions, readonly parameters: Record<string, ParameterValue>) {
    this.run = {
      id: options.id, mode: options.mode, project: wf.project, workflow: wf.workflow, startedAt: new Date(this.start).toISOString(),
      ...(options.parentId ? {parentId: options.parentId} : {}),
    };
    this.records = new Map(wf.nodes.map(node => [node.id, {
      nodeId: node.id, label: node.label, type: node.type, status: 'not-run',
      inputs: {}, outputs: {}, logs: [], inputSample: [], outputSample: {},
    }]));
    this.stopwatches = new Map(wf.nodes.map(node => [node.id, new Stopwatch()]));
    this.memories = new Map(wf.nodes.map(node => [node.id, new MemoryMeter()]));
    this.waits = new Map(wf.nodes.map(node => [node.id, new Stopwatch()]));
    // one channel per edge
    this.channels = wf.edges.map(e => ({...e, channel: new Channel<Envelope>()}));
  }

  recordOf(nodeId: string) { return this.records.get(nodeId)!; }
  stopwatchOf(nodeId: string) { return this.stopwatches.get(nodeId)!; }
  memoryOf(nodeId: string) { return this.memories.get(nodeId)!; }
  /** time waiting for outside systems (the context helpers that talk to them run it) */
  waitingOf(nodeId: string) { return this.waits.get(nodeId)!; }

  /** Runs every component until all of them finish, and returns the record. */
  async execute(initialEnvelopes: EnvelopeData[]): Promise<RunRecord> {
    this.initialEnvelopes = initialEnvelopes;
    // stopping from outside (button) or by timeout: tears down the channels and each component finishes what it was doing
    const onCancel = () => this.interrupt('Run cancelled.');
    const {signal, timeoutMs} = this.options;
    if (signal?.aborted) onCancel();
    signal?.addEventListener('abort', onCancel);
    const limit = timeoutMs
      ? setTimeout(() => this.interrupt(`Run interrupted: exceeded the maximum time (${Math.round(timeoutMs / 1000)} s).`), timeoutMs)
      : undefined;

    await Promise.all(this.wf.nodes.map(node => this.runNode(node)));

    clearTimeout(limit);
    signal?.removeEventListener('abort', onCancel);

    if (this.failure) return this.finish('failed', this.failure);
    // nothing reached the End: the flow ran, but delivered nothing
    const end = this.wf.nodes.find(n => n.type === END);
    const endRecord = end && this.records.get(end.id);
    if (endRecord && endRecord.status === 'completed' && !endRecord.inputs['in-0']) {
      endRecord.status = 'with-warnings';
      endRecord.logs.push({at: new Date().toISOString(), level: 'warning', message: 'No envelope reached the End.'});
    }

    const status = [...this.records.values()].map(r => r.status);
    return this.finish(status.includes('with-errors') ? 'with-errors' : status.includes('with-warnings') ? 'with-warnings' : 'completed');
  }

  /** Closes the run: the End's log line and the record with the components in flow order. */
  finish(status: RunRecord['status'], error?: string): RunRecord {
    const durationMs = Date.now() - this.start;
    // closes the log at the End, the pair of the Start's "started"
    const endRecord = this.records.get(this.wf.nodes.find(n => n.type === END)?.id ?? '');
    endRecord?.logs.push({
      at: new Date().toISOString(),
      level: status === 'failed' ? 'error' : status === 'completed' ? 'info' : 'warning',
      message: `Run ${this.run.id} finished (${STATUS_LABEL[status]}) in ${durationMs} ms.`,
    });
    return {
      run: this.run, parameters: this.parameters, status, error, end: new Date().toISOString(), durationMs,
      components: flowOrder(this.wf).map(id => this.records.get(id)!),
    };
  }

  /** Stops the run (Stop button, timeout): the first reason wins. */
  interrupt(reason: string) {
    this.failure ??= reason;
    this.abortAll();
  }

  private abortAll() {
    this.channels.forEach(c => c.channel.abort());
    this.control.abort();
  }

  /** Sources of each node input. Several edges into the same input (e.g. End) become one, in arrival order. */
  private inputsOf(nodeId: string) {
    const perPort: Record<string, AsyncIterable<Envelope>[]> = {};
    for (const e of this.channels.filter(c => c.target === nodeId)) (perPort[e.targetPort] ??= []).push(e.channel);
    return Object.fromEntries(Object.entries(perPort).map(([port, sources]) => [port, sources.length === 1 ? sources[0] : mergeSources(sources)]));
  }

  private outputsOf(nodeId: string, port: string) {
    return this.channels.filter(c => c.source === nodeId && c.sourcePort === port).map(c => c.channel);
  }

  private async send(node: ExecutableNode, port: string, doc: Envelope) {
    const rec = this.recordOf(node.id);
    // waiting for the next component (full queue) is not active time
    const stopwatch = this.stopwatchOf(node.id);
    const wasRunning = stopwatch.running;
    stopwatch.stop();
    rec.outputs[port] = (rec.outputs[port] ?? 0) + 1;
    if (this.outputsOf(node.id, port).length === 0) {
      const perPort = this.dropped.get(node.id) ?? {};
      perPort[port] = (perPort[port] ?? 0) + 1;
      this.dropped.set(node.id, perPort);
    }
    const sample = (rec.outputSample[port] ??= []);
    if (sample.length < SAMPLE_SIZE) sample.push(clone(doc.DATA));
    for (const channel of this.outputsOf(node.id, port)) await channel.send(doc);
    if (wasRunning) stopwatch.resume();
  }

  /**
   * Counts and samples what comes in, and marks the start on the first envelope. The component's stopwatch stops while
   * it waits for the next envelope and resumes when the envelope is delivered.
   */
  private async* watchInput(node: ExecutableNode, port: string, source: AsyncIterable<Envelope>) {
    const rec = this.recordOf(node.id);
    const stopwatch = this.stopwatchOf(node.id);
    stopwatch.stop();
    for await (const doc of source) {
      rec.start ??= new Date().toISOString();
      rec.inputs[port] = (rec.inputs[port] ?? 0) + 1;
      if (rec.inputSample.length < SAMPLE_SIZE) rec.inputSample.push(clone(doc.DATA));
      stopwatch.resume();
      yield doc;
      stopwatch.stop();
    }
  }

  private async runNode(node: ExecutableNode) {
    const rec = this.recordOf(node.id);
    const log = (level: LogLevel, message: string) => rec.logs.push({at: new Date().toISOString(), level, message});
    const outputPorts = [...new Set(this.channels.filter(c => c.source === node.id).map(c => c.sourcePort))];
    const stopwatch = this.stopwatchOf(node.id);
    const t0 = Date.now();
    let errors = 0;
    let dryRun = false;
    try {
      const inputs = Object.fromEntries(Object.entries(this.inputsOf(node.id)).map(([port, source]) => [port, this.watchInput(node, port, source)]));

      // pins are an editor aid: a real run (execution) always executes the node
      const pinned = this.options.mode === 'validation' ? node.pinned : undefined;
      if (node.pinned && !pinned) log('info', 'Pinned output ignored: in a real run the component always executes.');
      if (pinned) {
        log('info', 'Pinned output: did not execute, the input was dropped and the pinned envelopes went out.');
        // the ports at the same time: a component after it may read one input only after the other
        await Promise.all([
          ...Object.values(inputs).map(drain),
          ...Object.entries(pinned).map(async ([port, items]) => {
            for (const DATA of items) await this.send(node, port, {WORKFLOW_CURRENT_RUN: this.run, PARAMETERS: this.parameters, DATA: clone(DATA)});
          }),
        ]);
      } else if (node.type === START) {
        rec.start = new Date().toISOString();
        stopwatch.resume();
        for (const envelope of this.initialEnvelopes) {
          if (this.options.input !== undefined) {
            rec.inputs['in-0'] = (rec.inputs['in-0'] ?? 0) + 1;
            if (rec.inputSample.length < SAMPLE_SIZE) rec.inputSample.push(clone(envelope));
          }
          const doc: Envelope = {WORKFLOW_CURRENT_RUN: this.run, PARAMETERS: this.parameters, DATA: envelope};
          for (const port of outputPorts) await this.send(node, port, doc);
        }
        log('info', `Run ${this.run.id} started (${this.run.mode})${this.options.input !== undefined ? ' with input' : ''}.`);
      } else if (node.type === END) {
        for (const source of Object.values(inputs)) {
          for await (const doc of source) if (this.options.onReachEnd) await this.options.onReachEnd(doc);
        }
      } else if (node.disabled) {
        log('warning', 'Disabled (bypass): did not execute, the envelopes passed straight through.');
        for await (const doc of inputs['in-0'] ?? empty<Envelope>()) await this.send(node, 'out-0', doc);
      } else {
        const logic = COMPONENTS[node.type];
        if (!logic) throw new Error(`Component "${node.type}" does not exist in the runner.`);
        // THE gate for targets (section 12 of docs/architecture.md): in a test run a component with side effects writes
        // nothing (its ctx sends nothing) and nothing goes out of it, so its branch stops there. A pin replays (above).
        dryRun = this.options.mode === 'validation' && writesOutside(logic, node.config);
        const ctx = componentContext(this, node, log, dryRun);
        const send = async (port: string, doc: Envelope) => {
          if (!dryRun) await this.send(node, port, doc);
        };
        // the stopwatch runs while the component produces the next result (it discounts waiting for inputs)
        for await (const output of timedRequests(logic.execute(inputs, node.config, ctx), stopwatch)) {
          if ('port' in output) {
            await send(output.port, output.doc);
            continue;
          }
          const policy = errorPolicy(node);
          // Divert = handled error: the envelope goes out through the error port and the component does not count as "with errors"
          if (policy === 'divert') {
            log('warning', `Diverted to the error port: ${output.error.message}`);
            await send('error', withError(output.doc, output.error, node.label));
            continue;
          }
          errors += 1;
          log('error', output.error.message);
          if (policy === 'stop') throw new RunInterrupted(`"${node.label}": ${output.error.message}`);
          // continue: the incoming envelope goes out as it was through the main output and the flow moves on
          if (policy === 'continue') await send('out-0', output.doc);
        }
        if (dryRun) log('warning', 'Test run: nothing was written and nothing went on from here. Run for real to write.');
      }
      const lost = this.reportDropped(node, log);
      rec.status = errors > 0 ? 'with-errors' : node.pinned && this.options.mode === 'validation' ? 'pinned' : node.disabled ? 'disabled' : lost || dryRun ? 'with-warnings' : 'completed';
    } catch (e) {
      rec.status = 'failed';
      const message = e instanceof Error ? e.message : String(e);
      log('error', message);
      this.failure ??= e instanceof RunInterrupted ? message : `"${node.label}": ${message}`;
      this.abortAll();
    } finally {
      stopwatch.stop();
      rec.activeTimeMs = Math.round(stopwatch.total * 100) / 100;
      rec.memory = this.memoryOf(node.id).summary;
      const waiting = this.waitingOf(node.id).total;
      if (waiting > 0) rec.waitingMs = Math.round(waiting * 100) / 100;
      rec.start ??= new Date(t0).toISOString();
      rec.end = new Date().toISOString();
      rec.durationMs = Date.now() - Date.parse(rec.start);
      for (const port of outputPorts) for (const channel of this.outputsOf(node.id, port)) channel.close();
    }
  }

  /**
   * Logs the envelopes dropped by unconnected outputs. An optional output (e.g. Filter's false) only gets an info line;
   * any other one is a warning. Returns the non-optional losses, if any.
   */
  private reportDropped(node: ExecutableNode, log: (level: LogLevel, message: string) => void) {
    const defined = COMPONENTS[node.type]?.optionalOutputs ?? [];
    const optional = typeof defined === 'function' ? defined(node.config) : defined;
    for (const port of optional) {
      const n = this.dropped.get(node.id)?.[port];
      if (!n) continue;
      log('info', `${n} envelope(s) dropped by the output ${port}, which is not connected.`);
      delete this.dropped.get(node.id)![port];
    }
    if (this.dropped.get(node.id) && Object.keys(this.dropped.get(node.id)!).length === 0) this.dropped.delete(node.id);
    const lost = this.dropped.get(node.id);
    if (lost) {
      for (const [port, n] of Object.entries(lost)) {
        log('warning', `${n} envelope(s) dropped: the ${port === 'out-0' ? 'main' : port} output is not connected.`);
      }
    }
    return lost;
  }
}
