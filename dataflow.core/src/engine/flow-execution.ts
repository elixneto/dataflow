import {Channel, empty} from '../channel';
import {COMPONENTS} from '../components';
import {END, SAMPLE_SIZE, START} from '#engine/constants';
import {Stopwatch, timedRequests} from '#engine/stopwatch';
import {writesOutside} from '#engine/side-effects';
import {MemoryMeter} from '#engine/memory-meter';
import {flowOrder} from '#engine/flow-order';
import {errorPolicy, withError} from '#engine/error-envelope';
import {mergeSources} from '#engine/merge-sources';
import {ERROR_PORT, outputPorts} from '#validation/ports';
import {componentContext, hiddenValues, maskText} from '#engine/component-context';
import {skippedNodes} from '#engine/run-from';
import {RunInterrupted} from '#errors/run-interrupted';
import type {ComponentRun} from '#types/component-run.type';
import type {Envelope} from '#types/envelope.type';
import type {EnvelopeData} from '#types/envelope-data.type';
import type {ExecutableNode} from '#types/executable-node.type';
import type {ExecutableFlow} from '#types/executable-flow.type';
import type {LogLevel} from '#types/log-level.type';
import type {ParameterValue} from '#types/parameter.type';
import type {RunOptions} from '#types/run-options.type';
import type {RunProgress, RunRecord} from '#types/run-record.type';
import type {FlowCurrentRun} from '#types/flow-current-run.type';

/** how often a run's progress goes out (RunOptions.onProgress) */
const PROGRESS_MS = 250;

async function drain(source: AsyncIterable<Envelope>) {
  for await (const _ of source) { /* dropped */ }
}

/** Copy of the sample (the envelope moves on and may be changed by another component). */
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

const STATUS_LABEL: Record<RunRecord['status'], string> = {
  completed: 'completed', 'with-warnings': 'with warnings', 'with-errors': 'with errors', failed: 'failed',
};

/**
 * One run of a flow, envelope by envelope: each edge becomes a Channel and all components run at the same time.
 * Holds the run's state (records, stopwatches, memory, channels) and builds the record at the end.
 */
export class FlowExecution {
  readonly run: FlowCurrentRun;
  /** tells whoever talks to the outside (e.g. a database query, a called flow) that the run stopped */
  readonly control = new AbortController();

  private readonly start = Date.now();
  /** the same moment on the high-resolution clock: component times are dates from it, on the run's own clock (a long-lived
   * worker's performance.timeOrigin drifts from Date.now()) */
  private readonly startPerf = performance.now();
  private readonly isoAt = (at: number) => new Date(this.start + (at - this.startPerf)).toISOString();
  private readonly records: Map<string, ComponentRun>;
  private readonly stopwatches: Map<string, Stopwatch>;
  private readonly memories: Map<string, MemoryMeter>;
  private readonly waits: Map<string, Stopwatch>;
  private readonly channels: (ExecutableFlow['edges'][number] & {channel: Channel<Envelope>})[];
  /** envelopes that went out through an unconnected port (they vanish from the flow): per node and port */
  private readonly dropped = new Map<string, Record<string, number>>();
  private initialEnvelopes: EnvelopeData[] = [];
  /** what only feeds pinned (or replaying) components: not run */
  private readonly skipped: Set<string>;
  private failure?: string;

  constructor(readonly wf: ExecutableFlow, readonly options: RunOptions, readonly parameters: Record<string, ParameterValue>) {
    this.run = {
      id: options.id, mode: options.mode, project: wf.project, flow: wf.flow, startedAt: new Date(this.start).toISOString(),
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
    this.skipped = skippedNodes(wf, options.mode);
  }

  recordOf(nodeId: string) { return this.records.get(nodeId)!; }

  /** when each component opened (performance.now()): its first envelope, or the work it did before it */
  private readonly opened = new Map<string, number>();

  /**
   * Marks the component open, once: now (its first envelope), or when it started working if it did real work before
   * (a TypeScript component compiles its script first): what it did counts inside its open time.
   */
  private markOpen(nodeId: string) {
    if (this.opened.has(nodeId)) return;
    const stopwatch = this.stopwatchOf(nodeId);
    const at = stopwatch.total >= 1 && stopwatch.firstAt !== undefined ? stopwatch.firstAt : performance.now();
    this.opened.set(nodeId, at);
    this.recordOf(nodeId).start = this.isoAt(at);
  }
  /** Run from here: the component the run started from */
  fromOf() {
    const from = this.options.runFrom;
    return from ? {from: {nodeId: from.nodeId, label: from.label}} : {};
  }
  /** how many inputs of the node are fed in this run (asked for each envelope that comes in: counted once) */
  private inputPortsOf(nodeId: string) {
    let count = this.portCounts.get(nodeId);
    if (count === undefined) {
      const ports = new Set(this.channels.filter(c => c.target === nodeId).map(c => c.targetPort));
      if (this.options.runFrom?.nodeId === nodeId) Object.keys(this.options.runFrom.inputs).forEach(p => ports.add(p));
      count = ports.size;
      this.portCounts.set(nodeId, count);
    }
    return count;
  }
  private readonly portCounts = new Map<string, number>();
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

    // the run as it goes, for whoever follows it (the editor): every PROGRESS_MS while it runs
    const progress = this.options.onProgress ? setInterval(() => this.options.onProgress?.(this.progress()), PROGRESS_MS) : undefined;
    await Promise.all(this.wf.nodes.map(node => this.runNode(node)));
    clearInterval(progress);

    clearTimeout(limit);
    signal?.removeEventListener('abort', onCancel);

    if (this.failure) return this.finish('failed', this.failure);
    // nothing reached the End: the flow ran, but delivered nothing
    const end = this.wf.nodes.find(n => n.type === END);
    const endRecord = end && this.records.get(end.id);
    // ...unless envelopes went to a Discard: dropped on purpose
    const discarded = this.wf.nodes.some(n => n.type === 'discard' && Object.values(this.records.get(n.id)?.inputs ?? {}).some(count => count > 0));
    if (endRecord && endRecord.status === 'completed' && !endRecord.inputs['in-0'] && !discarded) {
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
      ...this.fromOf(),
      components: flowOrder(this.wf).map(id => this.records.get(id)!),
    };
  }

  /** The run so far: a copy of each component's record, in flow order (see RunOptions.onProgress). */
  progress(): RunProgress {
    return {
      run: this.run, parameters: this.parameters, status: 'running', durationMs: Date.now() - this.start,
      ...this.fromOf(),
      components: structuredClone(flowOrder(this.wf).map(id => this.records.get(id)!)),
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

  /**
   * Sources of each node input. Several edges into the same input (e.g. End) become one, in arrival order. Run from
   * here: the component it starts from gets what reached it in the last run.
   */
  private inputsOf(nodeId: string) {
    const perPort: Record<string, AsyncIterable<Envelope>[]> = {};
    for (const e of this.channels.filter(c => c.target === nodeId)) (perPort[e.targetPort] ??= []).push(e.channel);
    const from = this.options.runFrom;
    if (from?.nodeId === nodeId) {
      for (const [port, items] of Object.entries(from.inputs)) (perPort[port] ??= []).push(this.envelopesOf(items));
    }
    return Object.fromEntries(Object.entries(perPort).map(([port, sources]) => [port, sources.length === 1 ? sources[0] : mergeSources(sources)]));
  }

  private async* envelopesOf(items: EnvelopeData[]): AsyncIterable<Envelope> {
    for (const DATA of items) yield {FLOW_CURRENT_RUN: this.run, PARAMETERS: this.parameters, DATA: clone(DATA)};
  }

  private outputsOf(nodeId: string, port: string) {
    return this.channels.filter(c => c.source === nodeId && c.sourcePort === port).map(c => c.channel);
  }

  /**
   * A copy of an envelope's data for the record's samples, without the run's secrets and tokens: a response that
   * echoes one (an OAuth token in a body) is kept with *** in its place. The envelope itself goes on unchanged.
   */
  private sampled<T>(value: T): T {
    const hidden = hiddenValues(this.options);
    const text = JSON.stringify(value);
    if (text === undefined) return value;
    // as each value appears inside JSON text (quotes and backslashes escaped)
    return JSON.parse(maskText(text, hidden.map(v => JSON.stringify(v).slice(1, -1)))) as T;
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
    if (sample.length < SAMPLE_SIZE) sample.push(this.sampled(doc.DATA));
    // a port with several edges gives each its own copy: a path that changes the envelope does not touch what another
    // one received. One edge: the envelope itself.
    const channels = this.outputsOf(node.id, port);
    const copies = channels.slice(1).map(() => structuredClone(doc));
    for (const [i, channel] of channels.entries()) await channel.send(i === 0 ? doc : copies[i - 1]!);
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
      this.markOpen(node.id);
      if (rec.status === 'not-run') rec.status = 'running';
      rec.inputs[port] = (rec.inputs[port] ?? 0) + 1;
      if (rec.inputSample.length < SAMPLE_SIZE) rec.inputSample.push(this.sampled(doc.DATA));
      // several inputs: each one's first envelopes too (Run from here feeds them back to the right input)
      if (this.inputPortsOf(node.id) > 1) {
        const byPort = (rec.inputSampleByPort ??= {});
        const sample = (byPort[port] ??= []);
        if (sample.length < SAMPLE_SIZE) sample.push(this.sampled(doc.DATA));
      }
      stopwatch.resume();
      yield doc;
      stopwatch.stop();
    }
  }

  private async runNode(node: ExecutableNode) {
    const rec = this.recordOf(node.id);
    // what the record keeps never shows a secret or a token, whatever the component wrote
    const log = (level: LogLevel, message: string) => rec.logs.push({at: new Date().toISOString(), level, message: maskText(message, hiddenValues(this.options))});
    const outputPorts = [...new Set(this.channels.filter(c => c.source === node.id).map(c => c.sourcePort))];
    const stopwatch = this.stopwatchOf(node.id);
    const t0 = performance.now();
    let errors = 0;
    let dryRun = false;
    let replayed = false;
    // Run from here: the run starts at this component, with what reached it in the last run
    const from = this.options.runFrom?.nodeId === node.id ? this.options.runFrom : undefined;
    if (from) {
      log('info', `Run from here: ${from.label}.`);
      for (const [port, items] of Object.entries(from.inputs)) {
        const total = from.totals[port] ?? items.length;
        if (total > items.length) log('warning', `Only the first ${items.length} of the ${total} envelopes that reached ${port} in the last run came in: a run keeps ${items.length} per port.`);
      }
    }
    if (this.skipped.has(node.id)) {
      // it only feeds components that replay: nothing to do; what reaches it is read and dropped
      rec.status = 'skipped';
      await Promise.all(Object.values(this.inputsOf(node.id)).map(drain));
      for (const port of outputPorts) for (const channel of this.outputsOf(node.id, port)) channel.close();
      return;
    }
    // a component without inputs (the Start) runs from the beginning; the others once their first envelope arrives
    if (node.type === START) rec.status = 'running';
    try {
      const inputs = Object.fromEntries(Object.entries(this.inputsOf(node.id)).map(([port, source]) => [port, this.watchInput(node, port, source)]));

      // pins are an editor aid: a real run (execution) always executes the node
      const pinned = this.options.mode === 'validation' ? node.pinned : undefined;
      if (node.pinned && !pinned) log('info', 'Pinned output ignored: in a real run the component always executes.');
      if (pinned) {
        replayed = true;
        log('info', 'Pinned output: did not execute, the input was dropped and the pinned envelopes went out.');
        // the ports at the same time: a component after it may read one input only after the other
        await Promise.all([
          ...Object.values(inputs).map(drain),
          ...Object.entries(pinned).map(async ([port, items]) => {
            for (const DATA of items) await this.send(node, port, {FLOW_CURRENT_RUN: this.run, PARAMETERS: this.parameters, DATA: clone(DATA)});
          }),
        ]);
      } else if (node.type === START) {
        stopwatch.resume();
        this.markOpen(node.id);
        for (const envelope of this.initialEnvelopes) {
          if (this.options.input !== undefined) {
            rec.inputs['in-0'] = (rec.inputs['in-0'] ?? 0) + 1;
            if (rec.inputSample.length < SAMPLE_SIZE) rec.inputSample.push(this.sampled(envelope));
          }
          const doc: Envelope = {FLOW_CURRENT_RUN: this.run, PARAMETERS: this.parameters, DATA: envelope};
          for (const port of outputPorts) await this.send(node, port, doc);
        }
        log('info', `Run ${this.run.id} started (${this.run.mode})${this.options.input !== undefined ? ' with input' : ''}.`);
      } else if (node.type === END) {
        for (const source of Object.values(inputs)) {
          for await (const doc of source) if (this.options.onReachEnd) await this.options.onReachEnd(doc);
        }
      } else if (node.disabled) {
        log('warning', 'Bypass: did not execute, the envelopes passed straight through.');
        for await (const doc of inputs['in-0'] ?? empty<Envelope>()) await this.send(node, 'out-0', doc);
      } else {
        const logic = COMPONENTS[node.type];
        if (!logic) throw new Error(`Component "${node.type}" does not exist in the runner.`);
        // THE gate for targets (section 12 of docs/architecture.md): in a test run a component with side effects writes
        // nothing (its ctx sends nothing) and its envelopes go on marked `notSent`, so the rest of the flow (and a
        // called flow's End) is tested too. A pin replays (above).
        dryRun = this.options.mode === 'validation' && writesOutside(logic, node.config);
        const ctx = componentContext(this, node, log, dryRun);
        const send = (port: string, doc: Envelope) => this.send(node, port, doc);
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
            await send(ERROR_PORT, withError(output.doc, output.error, node.label));
            continue;
          }
          errors += 1;
          log('error', output.error.message);
          if (policy === 'throw') throw new RunInterrupted(`"${node.label}": ${output.error.message}`);
          // continue: the incoming envelope goes out as it was through the main output and the flow moves on
          if (policy === 'continue') await send('out-0', output.doc);
        }
        if (dryRun) log('info', 'Test run: nothing was written; the envelopes went on marked notSent. Run for real to write.');
      }
      const lost = this.reportDropped(node, log);
      rec.status = errors > 0 ? 'with-errors' : replayed ? 'pinned' : node.disabled ? 'disabled' : lost ? 'with-warnings' : 'completed';
    } catch (e) {
      rec.status = 'failed';
      const message = e instanceof Error ? e.message : String(e);
      // Stop policy: the error is already in this component's log (above), once
      if (!(e instanceof RunInterrupted)) log('error', message);
      this.failure ??= e instanceof RunInterrupted ? message : `"${node.label}": ${message}`;
      this.abortAll();
    } finally {
      stopwatch.stop();
      rec.activeTimeMs = Math.round(stopwatch.total * 100) / 100;
      rec.memory = this.memoryOf(node.id).summary;
      const waiting = this.waitingOf(node.id).total;
      if (waiting > 0) rec.waitingMs = Math.round(waiting * 100) / 100;
      // open from its first envelope (or the work it did before it), until now: the same clock as its active and
      // waiting times, so they fit in it
      const opened = this.opened.get(node.id) ?? t0;
      const now = performance.now();
      rec.start = this.isoAt(opened);
      rec.end = this.isoAt(now);
      rec.durationMs = Math.round((now - opened) * 100) / 100;
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
    // a port by its name (Filter's false, Lookup's not found), or its id when it has none
    const names = new Map(outputPorts(node.type, node.config).map(p => [p.id, p.label ?? p.id]));
    for (const port of optional) {
      const n = this.dropped.get(node.id)?.[port];
      if (!n) continue;
      log('info', `${n} envelope(s) dropped by the output ${names.get(port) ?? port}, which is not connected.`);
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
