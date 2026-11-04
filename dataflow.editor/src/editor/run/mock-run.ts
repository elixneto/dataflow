import {
  COMPONENTS,
  END,
  flowOrder,
  outputPorts,
  START,
  toExecutableFlow,
  type ComponentRun,
  type EnvelopeData,
  type FlowFile,
  type LogLine,
  type RunRecord,
} from '@dataflow/core';

/*
 * MOCK: a run's record (the core's RunRecord) made up from the flow as it is, to build the results screen before the
 * server runs flows. The envelopes follow the edges: the Start sends one (its default input when it accepts one), each
 * component passes them on (a Filter splits them, a Router spreads them over its cases, an Aggregate packs them), an
 * HTTP Request answers 200 with a JSON body. Nothing runs and nothing is sent. Same flow, same numbers.
 */

const ms = (index: number, base: number) => base + ((index * 37) % 23);

/** the Start's envelopes: its default input when it accepts one (a list = one per item), otherwise one empty */
function startEnvelopes(config: Record<string, unknown>): EnvelopeData[] {
  if (config.acceptsInput === true && typeof config.testInput === 'string' && config.testInput.trim()) {
    try {
      const input: unknown = JSON.parse(config.testInput);
      const items = Array.isArray(input) ? input : [input];
      return items.map(item => (typeof item === 'object' && item !== null ? (item as EnvelopeData) : { input: item }));
    } catch {
      // not JSON: one empty envelope below
    }
  }

  return [{}];
}

/** what a component makes of its envelopes, per output port (the mock's idea of it) */
function pass(type: string, config: Record<string, unknown>, envelopes: EnvelopeData[], label: string, key?: string): Record<string, EnvelopeData[]> {
  const ports = outputPorts(type, config).map(p => p.id);
  // the component's key in the envelope: the node's, or the component's default (HTTP Request: response)
  const withKey = (doc: EnvelopeData, value: unknown) => ({ ...doc, [key || COMPONENTS[type]?.defaultOutputKey || 'result']: value });
  switch (type) {
    case 'filter': {
      const cut = Math.ceil(envelopes.length * 0.7);
      return { 'out-0': envelopes.slice(0, cut), 'out-1': envelopes.slice(cut) };
    }
    case 'router':
    case 'distinct':
      return Object.fromEntries(ports.map((port, i) => [port, envelopes.filter((_, j) => j % ports.length === i)]));
    case 'aggregate':
      return { 'out-0': envelopes.length ? [{ [String(config.field ?? 'items')]: envelopes }] : [] };
    case 'limit':
      return { 'out-0': envelopes.slice(0, Number(config.count ?? 10)) };
    case 'http-request': {
      const url = typeof (config.url as { value?: unknown } | undefined)?.value === 'string' ? (config.url as { value: string }).value : '';
      return {
        'out-0': envelopes.map((doc, i) =>
          withKey(doc, {
            status: 200,
            headers: { 'content-type': 'application/json' },
            body: { id: 1000 + i, url: url || 'https://api.example.com', name: `${label} item ${i + 1}`, ok: true },
          }),
        ),
      };
    }
    case 'sqlserver':
    case 'mongodb-pipeline':
    case 'datagrid':
      return { 'out-0': envelopes.flatMap((doc, i) => [1, 2, 3].map(n => ({ ...doc, id: i * 3 + n, name: `row ${i * 3 + n}` }))) };
    case 'mapper':
      return { 'out-0': envelopes.map(doc => ({ ...doc, mapped: true })) };
    case 'typescript':
    case 'mongodb-upsert':
    case 'mongodb-delete':
    case 'lookup':
    case 'flow':
      return { 'out-0': envelopes.map(doc => withKey(doc, type === 'mongodb-upsert' ? { matched: 1, upsertedId: null } : type === 'mongodb-delete' ? { deleted: 1 } : { ok: true })) };
    default:
      return Object.fromEntries(ports.map((port, i) => [port, i === 0 ? envelopes : []]));
  }
}

const SAMPLE = 50;

/** the made-up record of a run of this flow (Run: a test run; Run for real: an execution) */
export function mockRunRecord(file: FlowFile, mode: 'validation' | 'execution', now = new Date()): RunRecord {
  const flow = toExecutableFlow(file, 'Mock');
  const order = flowOrder(flow);
  const byId = new Map(file.nodes.map(n => [n.id, n]));
  const received = new Map<string, Record<string, EnvelopeData[]>>();
  const add = (nodeId: string, port: string, envelopes: EnvelopeData[]) => {
    const ports = received.get(nodeId) ?? {};
    ports[port] = [...(ports[port] ?? []), ...envelopes];
    received.set(nodeId, ports);
  };

  const t0 = now.getTime();
  let clock = t0;
  const components: ComponentRun[] = [];
  order.forEach((id, index) => {
    const node = byId.get(id);
    if (!node) {
      return;
    }

    const inputs = received.get(id) ?? {};
    const all = Object.values(inputs).flat();
    const label = node.label || node.type;
    const reached = node.type === START || all.length > 0;
    const outputs: Record<string, EnvelopeData[]> = !reached
      ? {}
      : node.type === START
        ? { 'out-0': startEnvelopes(node.config) }
        : node.type === END || node.disabled
          ? node.disabled
            ? { 'out-0': all }
            : {}
          : pass(node.type, node.config, all, label, node.outputKey);
    for (const edge of flow.edges.filter(e => e.source === id)) {
      add(edge.target, edge.targetPort, outputs[edge.sourcePort] ?? []);
    }

    const duration = reached ? ms(index, node.type === 'http-request' ? 180 : 4) : 0;
    const start = new Date(clock).toISOString();
    clock += duration;
    const count = (ports: Record<string, EnvelopeData[]>) => Object.fromEntries(Object.entries(ports).map(([p, e]) => [p, e.length]));
    const sent = Object.values(outputs).reduce((n, e) => n + e.length, 0);
    const logs: LogLine[] = reached
      ? [{ at: start, level: 'info', message: node.type === START ? `${sent} envelope(s) sent.` : `${all.length} envelope(s) in, ${sent} out.` }]
      : [];
    if (node.type === 'http-request' && reached) {
      logs.push({ at: start, level: 'debug', message: `GET ${(node.config.url as { value?: string } | undefined)?.value || 'https://api.example.com'} → 200 in ${duration} ms.` });
    }

    components.push({
      nodeId: id,
      label,
      type: node.type,
      status: !reached ? 'not-run' : node.disabled ? 'disabled' : node.pinned && mode === 'validation' ? 'pinned' : 'completed',
      ...(reached ? { start, end: new Date(clock).toISOString(), durationMs: duration, activeTimeMs: Math.max(1, Math.round(duration / 10)) } : {}),
      ...(node.type === 'http-request' && reached ? { waitingMs: Math.round(duration * 0.9) } : {}),
      inputs: count(inputs),
      outputs: count(outputs),
      logs,
      inputSample: all.slice(0, SAMPLE),
      outputSample: Object.fromEntries(Object.entries(outputs).map(([p, e]) => [p, e.slice(0, SAMPLE)])),
    });
  });

  return {
    run: { id: crypto.randomUUID(), mode, project: 'Mock', flow: file.name, startedAt: now.toISOString() },
    parameters: Object.fromEntries(flow.parameters.map(p => [p.name, p.type === 'number' ? Number(p.default) : p.type === 'boolean' ? p.default === 'true' : p.default])),
    status: components.some(c => c.status === 'not-run' && c.type !== END) ? 'with-warnings' : 'completed',
    end: new Date(clock).toISOString(),
    durationMs: clock - t0,
    components,
  };
}
