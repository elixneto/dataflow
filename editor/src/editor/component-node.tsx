import {Fragment, memo, useCallback, useEffect, type CSSProperties} from 'react';
import {
  Handle,
  Position,
  useNodeConnections,
  useReactFlow,
  useUpdateNodeInternals,
  type Edge,
  type Node,
  type NodeProps,
} from '@xyflow/react';
import {Minus, Pin, Play, Plus, Power, StickyNote, TriangleAlert} from 'lucide-react';
import {CATEGORIES, CATEGORY_COLOR, isFlowNode, END, START, BY_TYPE} from '#components/catalog';
import type {Config} from '#types/config.type';
import {COMPONENTS, writesOutside, type EnvelopeData, type ErrorPolicy} from '@dataflow/core';
import {cn} from '#lib/utils';
import {useHistory} from '#editor/history';
import {useParameters} from '#editor/parameters-context';
import {useWarnings, useResult, useRunFrom} from '#editor/result-context';

export type ComponentData = {
  type: string;
  label: string;
  config: Config;
  disabled?: boolean;
  /** key the component adds to DATA */
  outputKey?: string;
  /** the output carries only this component's key (drops the rest of DATA) */
  override?: boolean;
  /** the user's free note (Notes tab of the window) */
  notes?: string;
  /** pinned output: the DATA of each envelope per output port; in editor runs the node does not execute and replays it */
  pinned?: Record<string, EnvelopeData[]>;
};

export type ComponentNode = Node<ComponentData, 'component'>;

export const ERROR_PORT = 'error';

const POLICIES: {value: ErrorPolicy; label: string; hint: string}[] = [
  {value: 'stop', label: 'Stop', hint: 'Stops the whole flow on the first error'},
  {value: 'continue', label: 'Continue', hint: 'On error, the incoming envelope goes out unchanged and the flow moves on'},
  {value: 'divert', label: 'Divert', hint: 'Sends the row with the error to the error output'},
];

const PORT_SPACING = 40;

export function errorPolicy(data: ComponentData): ErrorPolicy {
  const v = data.config.onError;
  return v === 'continue' || v === 'divert' ? v : 'stop';
}

// Start always has 1 output and End always 1 input (they come from the catalog, like the other components)
/** Number of node inputs. A Start that "accepts input": a port that takes the body from outside (webhook), without an edge. */
export function inputCount(data: ComponentData): number {
  if (data.type === START) return data.config.acceptsInput === true ? 1 : 0;
  const def = BY_TYPE[data.type];
  if (def?.variableInputs) return variableCount(data, def.variableInputs);
  return def?.inputs ?? 0;
}

/** Number of ports of a component with variable ports (e.g. Union, Copy), within the minimum and maximum. */
function variableCount(data: ComponentData, limits: {min: number; max: number; key: string}) {
  const n = Math.round(Number(data.config[limits.key] ?? limits.min));
  return Math.min(limits.max, Math.max(limits.min, Number.isFinite(n) ? n : limits.min));
}

/** Number of node outputs, besides the error port. */
export function outputCount(data: ComponentData): number {
  const def = BY_TYPE[data.type];
  if (def?.outputsFromConfig) return def.outputsFromConfig(data.config).length;
  if (def?.variableOutputs) return variableCount(data, def.variableOutputs);
  return def?.outputs ?? 0;
}

/** Name of the output (out-N) shown next to the port, if the component names its outputs. */
export function outputLabel(data: ComponentData, i: number): string | undefined {
  const def = BY_TYPE[data.type];
  if (def?.outputsFromConfig) return def.outputsFromConfig(data.config)[i]?.label;
  return def?.outputLabels?.[i];
}

/** Output that may stay unconnected (what goes out through it is dropped). */
export function isOptionalOutput(data: ComponentData, port: string): boolean {
  const optional = BY_TYPE[data.type]?.optionalOutputs ?? [];
  return (typeof optional === 'function' ? optional(data.config) : optional).includes(port);
}


/** Color of the output bump after running: green succeeded, red failed, orange moved on with an error/warning, gray disabled. */
function resultColor(status: string | undefined, policy: ErrorPolicy, envelopesOut: number) {
  if (!status || status === 'not-run') return undefined;
  // no envelope went out through this port (e.g. everything was diverted to the error): gray, the flow did not pass here
  if (status === 'completed') return envelopesOut > 0 ? 'success' : 'disabled';
  if (status === 'disabled') return 'disabled';
  if (status === 'pinned') return envelopesOut > 0 ? 'success' : 'disabled';
  if (status === 'with-warnings') return 'continued';
  if (status === 'with-errors' && policy === 'continue') return 'continued';
  return 'error';
}

function portPosition(i: number, total: number) {
  return `${((i + 1) / (total + 1)) * 100}%`;
}

const INPUT_RADIUS = 16;

/** Mask that "bites" a half circle out of the card's left border at each input (the canvas shows through the hole). */
function inputsMask(total: number): CSSProperties {
  if (total === 0) return {};
  const holes = Array.from({length: total}, (_, i) =>
    `radial-gradient(circle ${INPUT_RADIUS}px at -1px ${portPosition(i, total)}, transparent ${INPUT_RADIUS - 0.5}px, #000 ${INPUT_RADIUS}px)`);
  const image = holes.join(', ');
  return {
    maskImage: image,
    WebkitMaskImage: image,
    maskComposite: 'intersect',
    WebkitMaskComposite: 'source-in',
  } as CSSProperties;
}

function ComponentNodeView({id, data, selected}: NodeProps<ComponentNode>) {
  const {updateNodeData, getNode, setEdges} = useReactFlow<ComponentNode, Edge>();
  const updatePorts = useUpdateNodeInternals();
  const {record, recordEdit} = useHistory();
  const parameters = useParameters();
  const result = useResult()[id];
  const warnings = useWarnings()[id];
  const runFrom = useRunFrom();
  const incoming = useNodeConnections({handleType: 'target'});
  const outgoing = useNodeConnections({handleType: 'source'});
  const def = BY_TYPE[data.type];
  const inputs = inputCount(data);
  const outputs = outputCount(data);
  const flowNode = isFlowNode(data.type);
  const policy = errorPolicy(data);
  const hasErrorPolicy = !flowNode && !BY_TYPE[data.type]?.noError;
  const hasErrorPort = hasErrorPolicy && policy === 'divert';

  useEffect(() => {
    updatePorts(id);
  }, [id, inputs, outputs, hasErrorPort, updatePorts]);

  const setConfig = useCallback((key: string, value: unknown) => {
    recordEdit(`${id}:${key}`);
    updateNodeData(id, node => ({config: {...node.data.config, [key]: value}}));
  }, [id, updateNodeData, recordEdit]);

  if (!def) return null;

  const receivesRows = incoming.some(c => getNode(c.source)?.data.type !== START);

  function changePolicy(next: ErrorPolicy) {
    if (next === policy) return;
    record();
    if (next !== 'divert') {
      setEdges(current => current.filter(e => !(e.source === id && e.sourceHandle === ERROR_PORT)));
    }
    updateNodeData(id, node => ({config: {...node.data.config, onError: next}}));
  }

  /** −/+ of variable inputs: removing a port deletes the edge that arrived at it. */
  function changeInputs(delta: number) {
    const limits = def.variableInputs;
    if (!limits) return;
    const next = Math.min(limits.max, Math.max(limits.min, inputs + delta));
    if (next === inputs) return;
    record();
    if (next < inputs) {
      const removed = `in-${inputs - 1}`;
      setEdges(list => list.filter(e => !(e.target === id && e.targetHandle === removed)));
    }
    updateNodeData(id, node => ({config: {...node.data.config, [limits.key]: next}}));
  }

  /** −/+ of variable outputs: removing a port deletes the edge that left from it. */
  function changeOutputs(delta: number) {
    const limits = def.variableOutputs;
    if (!limits) return;
    const next = Math.min(limits.max, Math.max(limits.min, outputs + delta));
    if (next === outputs) return;
    record();
    if (next < outputs) {
      const removed = `out-${outputs - 1}`;
      setEdges(list => list.filter(e => !(e.source === id && e.sourceHandle === removed)));
    }
    updateNodeData(id, node => ({config: {...node.data.config, [limits.key]: next}}));
  }

  function toggleDisabled() {
    record();
    updateNodeData(id, {disabled: !data.disabled});
  }

  function unpin() {
    record();
    updateNodeData(id, {pinned: undefined});
  }

  // with inputs, the divider lines start after the hole (otherwise they cross the "bitten" notch)
  const indent = inputs > 0 ? 'ml-4 pl-1' : 'pl-5';
  const cat = CATEGORIES[def.category];
  const Icon = def.icon;
  const Card = def.Card;
  const maxPorts = Math.max(inputs, outputs);
  const style = {
    '--port-border': selected ? CATEGORY_COLOR[def.category] : 'color-mix(in oklch, var(--muted-foreground) 45%, transparent)',
    // the dot stays gray (white after a run, on the outputs); only Start and End take the color
    '--port-accent': isFlowNode(data.type) ? CATEGORY_COLOR[def.category] : 'var(--muted-foreground)',
    minHeight: maxPorts > 1 ? (maxPorts + 1) * PORT_SPACING : undefined,
  } as CSSProperties;

  return (
    <div
      className={cn(
        'snap-card relative isolate text-card-foreground transition-opacity',
        flowNode ? 'w-44' : 'w-72',
        data.disabled && 'opacity-45',
      )}
      style={style}
    >
      {/* background and border in a separate element: the mask that opens the input holes must not cut the ports */}
      <div aria-hidden="true" style={inputsMask(inputs)}
           className={cn('snap-card-bg pointer-events-none absolute inset-0 -z-10 rounded-xl border-[var(--port-border)] bg-node', selected ? 'border-[2.5px]' : 'border')}/>
      {Array.from({length: inputs}).map((_, i) => {
        const port = `in-${i}`;
        const connected = incoming.some(c => c.targetHandle === port);
        const name = def.inputLabels?.[i];
        return (
          <Fragment key={port}>
          {/* input name outside, right above the edge */}
          {name && (
            <span aria-hidden="true" style={{top: portPosition(i, inputs)}}
                  className="pointer-events-none absolute right-[calc(100%+14px)] -translate-y-[calc(100%+3px)] font-mono text-xs text-muted-foreground">
              {name}
            </span>
          )}
          <Handle id={port} type="target" position={Position.Left} style={{top: portPosition(i, inputs)}}
                  isConnectable={data.type !== START}
                  className={cn('snap-port snap-port-in', connected && 'is-connected', def.optionalInputs && 'is-optional', data.type === END && 'is-multiple')}
                  aria-label={data.type === START ? 'Workflow input' : name ? `Input ${name}` : def.optionalInputs ? `Input ${i + 1} (optional)` : `Input ${i + 1}`}>
            {/* on the Start the port is only the notch, without the dot: it does not accept edges */}
            {data.type !== START && <span className="snap-port-dot" aria-hidden="true"/>}
          </Handle>
          </Fragment>
        );
      })}

      <header className="flex items-center gap-2 py-2.5 pl-5 pr-3">
        <Icon className={cn('size-3.5 shrink-0', cat.textColor)} aria-hidden="true"/>
        <span className={cn('min-w-0 flex-1 truncate text-sm font-semibold', data.disabled && 'line-through')}>{data.label}</span>
        {writesOutside(COMPONENTS[data.type], data.config) && (
          <span title="Writes outside the flow: in a test run it sends nothing" className="shrink-0 rounded bg-entity/15 px-1.5 font-mono text-sm text-entity">writes</span>
        )}
        {warnings?.length ? (
          <span title={[...new Set(warnings)].join('\n')} className="flex shrink-0 text-destructive" aria-label="Has errors">
            <TriangleAlert className="size-4" aria-hidden="true"/>
          </span>
        ) : null}
        {data.notes?.trim() && (
          <span title={data.notes} className="flex shrink-0 text-comment" aria-label="Has a note">
            <StickyNote className="size-3.5" aria-hidden="true"/>
          </span>
        )}
        {data.pinned && (
          <button type="button" onClick={unpin} title="Pinned output: in editor runs it does not execute. Click to unpin." aria-label="Unpin output"
                  className="nodrag flex size-5 shrink-0 items-center justify-center rounded text-primary transition-colors hover:bg-accent">
            <Pin className="size-3" aria-hidden="true"/>
          </button>
        )}
        {runFrom.canPin.has(id) && (
          <button type="button" onClick={() => runFrom.pin(id)} title="Pin output (in editor runs it stops executing and sends the last output)" aria-label="Pin output"
                  className="nodrag flex size-5 shrink-0 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-accent hover:text-foreground">
            <Pin className="size-3" aria-hidden="true"/>
          </button>
        )}
        {runFrom.available.has(id) && (
          <button type="button" onClick={() => runFrom.run(id)} title="Run from here (reuses what reached it in the last run)" aria-label="Run from here"
                  className="nodrag flex size-5 shrink-0 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-accent hover:text-foreground">
            <Play className="size-3" aria-hidden="true"/>
          </button>
        )}
        {!flowNode && (
          <button type="button" onClick={toggleDisabled}
                  className={cn('nodrag flex size-5 shrink-0 items-center justify-center rounded transition-colors hover:bg-accent',
                    data.disabled ? 'text-destructive' : 'text-muted-foreground hover:text-foreground')}
                  aria-label={data.disabled ? 'Enable component' : 'Disable component'} aria-pressed={data.disabled ?? false}
                  title={data.disabled ? 'Enable' : 'Disable'}>
            <Power className="size-3" aria-hidden="true"/>
          </button>
        )}
      </header>

      {data.type === START && (
        <div className={cn('flex items-center justify-between gap-2 border-t border-border py-2 pr-3', indent)}
             title={parameters.length ? parameters.map(p => `$PARAMETERS.${p.name || '?'} = ${p.default || '""'}`).join('\n') : 'Double-click to create parameters'}>
          <span className="text-xs font-medium text-muted-foreground">Parameters</span>
          <span className={cn('rounded-full px-2 font-mono text-xs', parameters.length ? 'bg-flow/15 text-foreground' : 'text-muted-foreground')}>{parameters.length}</span>
        </div>
      )}

      {def.variableInputs && (
        <PortCounter label="Inputs" singular="input" count={inputs} limits={def.variableInputs} onChange={changeInputs} className={indent}/>
      )}
      {def.variableOutputs && (
        <PortCounter label="Outputs" singular="output" count={outputs} limits={def.variableOutputs} onChange={changeOutputs} className={indent}/>
      )}

      {!flowNode && Card && (
        <div className={cn('border-t border-border py-3 pr-5', indent)}>
          <Card id={id} nodeId={id} config={data.config} setConfig={setConfig} receivesRows={receivesRows}/>
        </div>
      )}

      {hasErrorPolicy && (
        <div className={cn('flex flex-col gap-1.5 border-t border-border pr-5 pt-2.5', indent, hasErrorPort ? 'pb-5' : 'pb-3')}>
          <span id={`${id}-on-error`} className="text-xs font-medium text-muted-foreground">On error</span>
          <div role="radiogroup" aria-labelledby={`${id}-on-error`}
               className="nodrag grid grid-cols-3 gap-0.5 rounded-md border border-input bg-background p-0.5">
            {POLICIES.map(p => {
              const active = p.value === policy;
              return (
                <button key={p.value} type="button" role="radio" aria-checked={active} title={p.hint} onClick={() => changePolicy(p.value)}
                        className={cn('h-6 rounded px-1 text-xs font-medium transition-colors',
                          active ? (p.value === 'divert' ? 'bg-destructive/20 text-destructive' : 'bg-accent text-foreground')
                            : 'text-muted-foreground hover:text-foreground')}>
                  {p.label}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {hasErrorPort && (
        <Handle id={ERROR_PORT} type="source" position={Position.Bottom}
                className={cn('snap-port snap-port-error', outgoing.some(c => c.sourceHandle === ERROR_PORT) && 'is-connected')}
                data-result={result?.outputs[ERROR_PORT] ? 'error' : undefined}
                aria-label="Error output" title="Error output">
          <span className="snap-port-dot" aria-hidden="true"/>
        </Handle>
      )}

      {Array.from({length: outputs}).map((_, i) => {
        const port = `out-${i}`;
        const connected = outgoing.some(c => c.sourceHandle === port);
        const name = outputLabel(data, i);
        return (
          <Fragment key={port}>
            <Handle id={port} type="source" position={Position.Right} style={{top: portPosition(i, outputs)}}
                    data-result={resultColor(result?.status, policy, result?.outputs[port] ?? 0)}
                    className={cn('snap-port snap-port-out', connected && 'is-connected', isOptionalOutput(data, port) && 'is-optional')} aria-label={name ? `Output ${name}` : `Output ${i + 1}`}>
              <span className="snap-port-dot" aria-hidden="true"/>
            </Handle>
            {/* output name outside, right above the edge */}
            {name && (
              <span aria-hidden="true" style={{top: portPosition(i, outputs)}}
                    className="pointer-events-none absolute left-[calc(100%+14px)] -translate-y-[calc(100%+3px)] font-mono text-xs text-muted-foreground">
                {name}
              </span>
            )}
          </Fragment>
        );
      })}
    </div>
  );
}

export const ComponentNodeMemo = memo(ComponentNodeView);

/** −/+ of a component with variable ports (Union inputs, Copy outputs). */
function PortCounter({label, singular, count, limits, onChange, className}: {
  label: string;
  singular: string;
  count: number;
  limits: {min: number; max: number};
  onChange: (delta: number) => void;
  className: string;
}) {
  return (
    <div className={cn('flex items-center justify-between gap-2 border-t border-border py-2 pr-3', className)}>
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      <div className="flex items-center gap-1">
        <button type="button" onClick={() => onChange(-1)} disabled={count <= limits.min}
                className="nodrag flex size-5 items-center justify-center rounded border border-input text-muted-foreground hover:text-foreground disabled:opacity-40"
                aria-label={`Remove ${singular}`}>
          <Minus className="size-3" aria-hidden="true"/>
        </button>
        <span className="w-7 text-center font-mono text-xs" aria-live="polite">{count}</span>
        <button type="button" onClick={() => onChange(1)} disabled={count >= limits.max}
                className="nodrag flex size-5 items-center justify-center rounded border border-input text-muted-foreground hover:text-foreground disabled:opacity-40"
                aria-label={`Add ${singular}`}>
          <Plus className="size-3" aria-hidden="true"/>
        </button>
      </div>
    </div>
  );
}
