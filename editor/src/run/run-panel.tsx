import {useState, type ReactNode} from 'react';
import {ChevronDown, ChevronRight, ChevronUp, CircleAlert, CircleCheck, CircleMinus, CircleX, Clock, Loader2, Pin, PinOff} from 'lucide-react';
import {SAMPLE_SIZE, type ComponentRun, type EnvelopeData, type RunRecord} from '@dataflow/core';
import {cn} from '#lib/utils';
import {BY_TYPE} from '#components/catalog';

type Tab = 'logs' | 'metrics' | 'data';

export const STATUS_LABEL: Record<RunRecord['status'], string> = {
  completed: 'Completed',
  'with-warnings': 'Completed with warnings',
  'with-errors': 'Completed with errors',
  failed: 'Failed',
};

const COMPONENT_STATUS_LABEL: Record<ComponentRun['status'], string> = {
  'not-run': 'Did not run',
  completed: 'Completed',
  disabled: 'Disabled (bypass)',
  pinned: 'Pinned output',
  'with-warnings': 'With warnings',
  'with-errors': 'With errors',
  failed: 'Failed',
};

export const ms = (value?: number) => (value === undefined ? '—' : value < 1000 ? `${value} ms` : `${(value / 1000).toFixed(2)} s`);
/** Active time: below 10 ms the fraction is worth showing (most components stay in tenths of a ms). */
const activeMs = (value?: number) => (value === undefined ? '—' : value < 10 ? `${value.toLocaleString('en-US', {maximumFractionDigits: 2})} ms` : ms(Math.round(value)));
const bytes = (value: number) => (value < 1024 ? `${value} B` : value < 1024 ** 2 ? `${(value / 1024).toFixed(1)} KB` : `${(value / 1024 ** 2).toFixed(1)} MB`);
const time = (iso?: string) => (iso ? new Date(iso).toLocaleTimeString('en-US', {hour12: false}) + '.' + String(new Date(iso).getMilliseconds()).padStart(3, '0') : '—');
const total = (port: Record<string, number>) => Object.values(port).reduce((s, n) => s + n, 0);
/** Readable name of a node port (e.g. "CA", "false", "input 2", "error"). */
export type PortName = (nodeId: string, port: string) => string;

/** The total in large and, if it went through more than one port, how much went through each one below. */
function Count({port, nodeId, portName, noPorts}: {port: Record<string, number>; nodeId: string; portName: PortName; noPorts: boolean}) {
  if (noPorts) return <span className="text-right font-mono text-xs text-muted-foreground">—</span>;
  const ports = Object.entries(port);
  return (
    <span className="flex flex-col items-end gap-0.5">
      <span className="font-mono text-xs">{total(port)}</span>
      {ports.length > 1 && (
        <span className="flex flex-wrap justify-end gap-1">
          {ports.map(([p, n]) => (
            <span key={p} className={cn('rounded px-1.5 text-xs', p === 'error' ? 'bg-destructive/15 text-destructive' : 'bg-muted text-muted-foreground')}>
              {portName(nodeId, p)}: <span className="font-mono text-foreground">{n}</span>
            </span>
          ))}
        </span>
      )}
    </span>
  );
}

export function StatusIcon({status}: {status: ComponentRun['status'] | RunRecord['status']}) {
  if (status === 'completed') return <CircleCheck className="size-4 shrink-0 text-entity" aria-label="Completed"/>;
  if (status === 'with-warnings') return <CircleAlert className="size-4 shrink-0 text-comment" aria-label="With warnings"/>;
  if (status === 'with-errors') return <CircleAlert className="size-4 shrink-0 text-destructive" aria-label="With errors"/>;
  if (status === 'failed') return <CircleX className="size-4 shrink-0 text-destructive" aria-label="Failed"/>;
  if (status === 'pinned') return <Pin className="size-4 shrink-0 text-primary" aria-label="Pinned output"/>;
  if (status === 'disabled') return <CircleMinus className="size-4 shrink-0 text-muted-foreground" aria-label="Disabled"/>;
  return <Clock className="size-4 shrink-0 text-muted-foreground" aria-label="Did not run"/>;
}

function Json({value}: {value: unknown}) {
  return (
    <pre className="max-h-56 overflow-auto rounded-md border border-border bg-background p-2 font-mono text-xs leading-relaxed">
      {JSON.stringify(value, null, 2)}
    </pre>
  );
}

// ---------- Logs: every component, in time order ----------

function LogsTab({record}: {record: RunRecord}) {
  const lines = record.components
    .flatMap((c, order) => c.logs.map(l => ({...l, order: order + 1, label: c.label})))
    .sort((a, b) => a.at.localeCompare(b.at) || a.order - b.order);
  if (lines.length === 0) return <p className="px-4 py-3 text-sm text-muted-foreground">No logs.</p>;
  return (
    <ul className="flex flex-col gap-0.5 px-4 py-2 font-mono text-xs">
      {lines.map((l, i) => (
        <li key={i} className={cn(l.level === 'error' && 'text-destructive', l.level === 'warning' && 'text-comment')}>
          <span className="text-muted-foreground">{time(l.at)}</span>{' '}
          <span className="text-muted-foreground">[{l.order} {l.label}]</span> {l.message}
        </li>
      ))}
    </ul>
  );
}

// ---------- Metrics: one row per component ----------

const METRICS_COLUMNS = 'grid-cols-[16px_minmax(0,1fr)_110px_120px_minmax(90px,200px)_minmax(90px,200px)_80px_80px_100px_110px]';

/** Component name (Mapper, Filter...); the label is what the user gave the node. */
const componentName = (type: string) => BY_TYPE[type]?.label ?? type;

function MetricsTab({record, onGoTo, portName}: {record: RunRecord; onGoTo: (nodeId: string) => void; portName: PortName}) {
  return (
    <div className="flex flex-col">
      <div className={cn('grid gap-2 border-b border-border px-4 py-1.5 text-xs text-muted-foreground', METRICS_COLUMNS)}>
        <span/><span>Label</span><span>Component</span><span>Status</span><span className="text-right">In</span><span className="text-right">Out</span>
        <span className="text-right" title="From the first to the last envelope, including the waiting">Duration</span>
        <span className="text-right" title="Time processing, without waiting for envelopes or for the next component (practically the component's CPU)">Active</span>
        <span className="text-right" title="Peak of what the component held at once (e.g. the Lookup table, the Aggregate batch); size estimated from the JSON">Memory</span>
        <span className="text-right">Start</span>
      </div>
      <ul>
        {record.components.map((c, i) => (
          <li key={c.nodeId} className="border-b border-border last:border-b-0">
            <button type="button" onClick={() => onGoTo(c.nodeId)} title="Show on the canvas"
                    className={cn('grid w-full items-center gap-2 px-4 py-2 text-left text-sm hover:bg-accent', METRICS_COLUMNS)}>
              <StatusIcon status={c.status}/>
              <span className="truncate font-medium"><span className="mr-2 font-mono text-xs text-muted-foreground">{i + 1}</span>{c.label}</span>
              <span className="truncate text-xs text-muted-foreground">{componentName(c.type)}</span>
              <span className="truncate text-xs text-muted-foreground">{COMPONENT_STATUS_LABEL[c.status]}</span>
              <Count port={c.inputs} nodeId={c.nodeId} portName={portName} noPorts={c.type === 'start' && total(c.inputs) === 0}/>
              <Count port={c.outputs} nodeId={c.nodeId} portName={portName} noPorts={c.type === 'end'}/>
              <span className="text-right font-mono text-xs">{ms(c.durationMs)}</span>
              <span className="text-right font-mono text-xs">{activeMs(c.activeTimeMs)}</span>
              {c.memory
                ? <span className="flex flex-col items-end gap-0.5 font-mono text-xs">
                    <span>{bytes(c.memory.peakBytes)}</span>
                    <span className="text-muted-foreground">{c.memory.peakEnvelopes.toLocaleString('en-US')} env.</span>
                  </span>
                : <span className="text-right font-mono text-xs text-muted-foreground">—</span>}
              <span className="text-right font-mono text-xs text-muted-foreground">{time(c.start)}</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

// ---------- Data: input and output preview of each component ----------

/** Pinning from the result: the nodes already pinned and the action (undefined unpins). */
export type PinActions = {
  pinned: Set<string>;
  onPin: (nodeId: string, pinned: Record<string, EnvelopeData[]> | undefined) => void;
};

/** Pin / Unpin of a component's main output, under its output preview. */
function PinButton({c, actions}: {c: ComponentRun; actions: PinActions}) {
  if (actions.pinned.has(c.nodeId)) {
    return (
      <button type="button" onClick={() => actions.onPin(c.nodeId, undefined)}
              className="flex h-7 items-center gap-1.5 rounded-md border border-input px-2 text-xs text-muted-foreground hover:text-foreground">
        <PinOff className="size-3.5" aria-hidden="true"/> Unpin
      </button>
    );
  }
  const main = c.outputSample['out-0'];
  if (c.type === 'start' || c.type === 'end' || c.status === 'not-run' || c.status === 'failed' || !main) return null;
  const cut = (c.outputs['out-0'] ?? 0) > main.length;
  return (
    <button type="button" onClick={() => actions.onPin(c.nodeId, {'out-0': structuredClone(main)})}
            title={cut ? `Only the first ${SAMPLE_SIZE} envelopes are pinned` : 'In editor runs, the node stops executing and sends this out through its main output'}
            className="flex h-7 items-center gap-1.5 rounded-md border border-input px-2 text-xs text-muted-foreground hover:text-foreground">
      <Pin className="size-3.5" aria-hidden="true"/> Pin output{cut ? ` (first ${SAMPLE_SIZE})` : ''}
    </button>
  );
}

function DataTab({record, pins}: {record: RunRecord; pins?: PinActions}) {
  const [open, setOpen] = useState<Set<string>>(() => new Set(record.components.slice(1, 2).map(c => c.nodeId)));
  const toggle = (id: string) => setOpen(current => {
    const next = new Set(current);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    return next;
  });
  return (
    <ul>
      {record.components.map((c, i) => {
        const isOpen = open.has(c.nodeId);
        const ports = Object.keys(c.outputSample);
        return (
          <li key={c.nodeId} className="border-b border-border last:border-b-0">
            <button type="button" onClick={() => toggle(c.nodeId)} aria-expanded={isOpen}
                    className="flex w-full items-center gap-2 px-4 py-2 text-left text-sm hover:bg-accent">
              {isOpen ? <ChevronDown className="size-4 text-muted-foreground"/> : <ChevronRight className="size-4 text-muted-foreground"/>}
              <StatusIcon status={c.status}/>
              <span className="font-mono text-xs text-muted-foreground">{i + 1}</span>
              <span className="truncate font-medium">{c.label}</span>
              <span className="ml-auto font-mono text-xs text-muted-foreground">{total(c.inputs)} ⟶ {total(c.outputs)}</span>
            </button>
            {isOpen && (
              <div className="grid gap-3 px-10 pb-4 pt-1 text-xs lg:grid-cols-2">
                <div>
                  <h4 className="mb-1 font-medium text-muted-foreground">Input (up to {SAMPLE_SIZE})</h4>
                  {c.inputSample.length ? <Json value={c.inputSample}/> : <p className="text-muted-foreground">Nothing came in.</p>}
                </div>
                <div>
                  <h4 className="mb-1 font-medium text-muted-foreground">{ports.length > 1 ? 'Output by port' : 'Output'} (up to {SAMPLE_SIZE})</h4>
                  {ports.length === 0 ? <p className="text-muted-foreground">Nothing went out.</p>
                    // a single port (the usual): shows the envelopes directly, without the "out-0" around them
                    : ports.length === 1 ? <Json value={c.outputSample[ports[0]]}/>
                      : <Json value={c.outputSample}/>}
                  {pins && <div className="mt-2 flex"><PinButton c={c} actions={pins}/></div>}
                </div>
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}

/** A run's result in tabs: Logs (all, by time), Metrics (per component) and Data (input and output). */
export function RunResult({record, onGoTo, portName, actions, pins, busy, collapsed}: {
  record: RunRecord;
  onGoTo: (nodeId: string) => void;
  portName: PortName;
  /** in the editor: pin a component's output from the Data tab */
  pins?: PinActions;
  /** buttons to the right of the tabs (e.g. minimize the panel) */
  actions?: ReactNode;
  /** a new run is in progress: the tabs and their content are read-only until it ends */
  busy?: boolean;
  /** only the header (the panel minimized); the tab and what is open in it are kept */
  collapsed?: boolean;
}) {
  const [tab, setTab] = useState<Tab>('logs');

  return (
    <>
      <header className="flex flex-wrap items-center gap-x-4 gap-y-1 border-b border-border px-4 py-2 text-sm">
        <StatusIcon status={record.status}/>
        <span className="font-medium">{STATUS_LABEL[record.status]}</span>
        <span className="font-mono text-xs text-muted-foreground" title="WORKFLOW_CURRENT_RUN.id">{record.run.id.slice(0, 8)}</span>
        <span className="text-xs text-muted-foreground">startedAt <span className="font-mono text-foreground">{record.run.startedAt}</span></span>
        <span className="text-xs text-muted-foreground">total <span className="font-mono text-foreground">{ms(record.durationMs)}</span></span>
        <div role="tablist" inert={busy} className={cn('ml-auto flex gap-1', busy && 'opacity-60', collapsed && 'invisible')}>
          {([['logs', 'Logs'], ['metrics', 'Metrics'], ['data', 'Data']] as const).map(([value, label]) => (
            <button key={value} type="button" role="tab" aria-selected={tab === value} onClick={() => setTab(value)}
                    className={cn('rounded-md px-3 py-1 text-sm transition-colors',
                      tab === value ? 'bg-accent font-medium text-foreground' : 'text-muted-foreground hover:text-foreground')}>
              {label}
            </button>
          ))}
        </div>
        {actions}
      </header>
      {record.error && !collapsed && <p className="border-b border-border bg-destructive/10 px-4 py-2 text-sm text-destructive">{record.error}</p>}
      <div role="tabpanel" inert={busy} aria-busy={busy} hidden={collapsed} className={cn('min-h-0 overflow-y-auto', busy && 'cursor-progress opacity-60')}>
        {tab === 'logs' && <LogsTab record={record}/>}
        {tab === 'metrics' && <MetricsTab record={record} onGoTo={onGoTo} portName={portName}/>}
        {tab === 'data' && <DataTab record={record} pins={pins}/>}
      </div>
    </>
  );
}

/**
 * The result in the editor's footer. A new run updates it in place (the tab and the open components stay); while it
 * runs, the panel is read-only. Minimized, only a bar is left.
 */
export function RunPanel({record, busy, minimized, onMinimize, onGoTo, portName, pinned, onPin}: {
  record: RunRecord;
  busy: boolean;
  minimized: boolean;
  onMinimize: (minimized: boolean) => void;
  onGoTo: (nodeId: string) => void;
  portName: PortName;
} & PinActions) {
  return (
    <section className="relative z-20 flex max-h-[55%] shrink-0 flex-col border-t border-border bg-sidebar shadow-2xl" aria-label="Run result">
      <RunResult record={record} busy={busy} collapsed={minimized} onGoTo={onGoTo} portName={portName} pins={{pinned, onPin}} actions={
        <>
          {busy && (
            <span className="flex items-center gap-1.5 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" aria-hidden="true"/> Running…
            </span>
          )}
          <button type="button" onClick={() => onMinimize(!minimized)} className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
                  aria-label={minimized ? 'Restore result' : 'Minimize result'} aria-expanded={!minimized}>
            {minimized ? <ChevronUp className="size-4" aria-hidden="true"/> : <ChevronDown className="size-4" aria-hidden="true"/>}
          </button>
        </>
      }/>
    </section>
  );
}
