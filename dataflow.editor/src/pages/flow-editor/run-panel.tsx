import { useMemo, useState, type PointerEvent, type ReactNode } from 'react';
import { ChevronDown, ChevronUp, CircleAlert, CircleCheck, CircleMinus, CircleX, LoaderCircle, Pin, Power, X } from 'lucide-react';
import type { EnvelopeData, LogLine, RunRecord } from '@dataflow/core';
import { Button } from '@/components/ui/button';
import { componentInfo } from '@/editor/catalog';
import { cn } from '@/lib/utils';
import { readChoice, rememberChoice } from '@/editor/run/run-choices';
import { runActions } from '@/editor/run/run-marks';

/*
 * MOCK: a run's result under the canvas, as in the PoC (Logs, Metrics, Data), from the core's RunRecord. Its height is
 * dragged by the top edge and kept in this browser tab; it collapses to its header (status, time, envelopes).
 */

type Tab = 'logs' | 'metrics' | 'data';

const HEIGHT_KEY = 'dataflow.runPanel.height';
const DEFAULT_HEIGHT = 300;
const MIN_HEIGHT = 140;

const readHeight = () => {
  try {
    const h = Number(sessionStorage.getItem(HEIGHT_KEY));
    return Number.isFinite(h) && h >= MIN_HEIGHT ? h : DEFAULT_HEIGHT;
  } catch {
    return DEFAULT_HEIGHT;
  }
};

const rememberHeight = (h: number) => {
  try {
    sessionStorage.setItem(HEIGHT_KEY, String(Math.round(h)));
  } catch {
    // no storage: the default height next time
  }
};

const TAB_KEY = 'dataflow.run.tab';
const VIEW_KEY = 'dataflow.run.dataView';
const TABS = ['logs', 'metrics', 'data'] as const;
const VIEWS = ['table', 'json'] as const;

const ms = (value?: number) => (value === undefined ? '—' : value < 1000 ? `${Math.round(value)} ms` : `${(value / 1000).toFixed(2)} s`);
const total = (ports: Record<string, number>) => Object.values(ports).reduce((n, v) => n + v, 0);
const time = (iso: string) => {
  const d = new Date(iso);
  return `${d.toLocaleTimeString('en-US', { hour12: false })}.${String(d.getMilliseconds()).padStart(3, '0')}`;
};

const STATUS: Record<string, { icon: typeof CircleCheck; color: string; label: string }> = {
  completed: { icon: CircleCheck, color: 'text-emerald-600 dark:text-emerald-400', label: 'Completed' },
  'with-warnings': { icon: CircleAlert, color: 'text-amber-600 dark:text-amber-400', label: 'With warnings' },
  'with-errors': { icon: CircleX, color: 'text-destructive', label: 'With errors' },
  failed: { icon: CircleX, color: 'text-destructive', label: 'Failed' },
  pinned: { icon: Pin, color: 'text-blue-600 dark:text-blue-400', label: 'Pinned output' },
  disabled: { icon: Power, color: 'text-muted-foreground', label: 'Disabled' },
  'not-run': { icon: CircleMinus, color: 'text-muted-foreground', label: 'Not run' },
};

function StatusIcon({ status, className }: { status: string; className?: string }) {
  const s = STATUS[status] ?? STATUS['not-run']!;
  return <s.icon className={cn('size-4 shrink-0', s.color, className)} aria-label={s.label} />;
}

export type RunPanelProps = {
  record: RunRecord | null;
  /** a run is in progress (a test run or for real) */
  running: 'test' | 'real' | null;
  onFocus: (nodeId: string) => void;
  /** the nodes whose output is pinned, and the action to pin or unpin one */
  pinned: Set<string>;
  onPin: (nodeId: string, pinned: boolean) => void;
  onClose: () => void;
  /** a port's count was clicked: the Data tab on that component, that port in view (`at` tells two clicks apart) */
  show?: { nodeId: string; port: string; at: number } | null;
};

export function RunPanel({ record, running, onFocus, pinned, onPin, onClose, show }: RunPanelProps) {
  const [height, setHeight] = useState(readHeight);
  const [collapsed, setCollapsed] = useState(false);
  const [tab, setTabState] = useState<Tab>(() => readChoice(TAB_KEY, TABS, 'logs'));
  const setTab = (next: Tab) => {
    setTabState(next);
    rememberChoice(TAB_KEY, next);
  };
  // a count clicked on the canvas: open, on the Data tab (the request is applied once, when it changes)
  const [shown, setShown] = useState<number | undefined>(undefined);
  if (show && show.at !== shown) {
    setShown(show.at);
    setCollapsed(false);
    setTabState('data');
  }
  const [drag, setDrag] = useState<{ y: number; h: number } | null>(null);

  const startResize = (event: PointerEvent<HTMLDivElement>) => {
    event.currentTarget.setPointerCapture(event.pointerId);
    setDrag({ y: event.clientY, h: height });
  };
  const resize = (event: PointerEvent<HTMLDivElement>) => {
    if (drag) {
      setHeight(Math.min(Math.max(drag.h + drag.y - event.clientY, MIN_HEIGHT), window.innerHeight * 0.75));
    }
  };
  const endResize = () => {
    if (drag) {
      rememberHeight(height);
      setDrag(null);
    }
  };

  const start = record?.components.find(c => c.type === 'start');
  const end = record?.components.find(c => c.type === 'end');

  return (
    <section aria-label="Run result" className="relative flex shrink-0 flex-col border-t bg-card text-card-foreground" style={{ height: collapsed ? undefined : height }}>
      {!collapsed && (
        <div
          role="separator"
          aria-orientation="horizontal"
          aria-label="Resize the run panel"
          onPointerDown={startResize}
          onPointerMove={resize}
          onPointerUp={endResize}
          className="absolute inset-x-0 -top-1 z-10 h-2 cursor-ns-resize hover:bg-primary/20"
        />
      )}
      <header className="flex h-10 shrink-0 items-center gap-3 border-b px-3 text-sm">
        {running ? (
          <span className="flex items-center gap-2 font-medium">
            <LoaderCircle className="size-4 animate-spin text-muted-foreground" aria-hidden />
            {running === 'real' ? 'Running for real…' : 'Running…'}
          </span>
        ) : record ? (
          <>
            <span className="flex items-center gap-2 font-medium">
              <StatusIcon status={record.status} />
              {STATUS[record.status]?.label}
            </span>
            <span className="text-xs text-muted-foreground">{record.run.mode === 'execution' ? 'Run for real' : 'Test run'}</span>
            <span className="font-mono text-xs text-muted-foreground">{ms(record.durationMs)}</span>
            <span className="font-mono text-xs text-muted-foreground" title="Envelopes the Start sent → envelopes that reached the End">
              {start ? total(start.outputs) : 0} → {end ? total(end.inputs) : 0} envelopes
            </span>
          </>
        ) : null}
        {!collapsed && record && !running && (
          <div role="tablist" className="ml-4 flex gap-1">
            {TABS.map(t => (
              <button
                key={t}
                type="button"
                role="tab"
                aria-selected={tab === t}
                onClick={() => setTab(t)}
                className={cn('rounded-md px-2.5 py-1 text-xs capitalize transition-colors', tab === t ? 'bg-accent font-medium' : 'text-muted-foreground hover:text-foreground')}
              >
                {t}
              </button>
            ))}
          </div>
        )}
        <div className="ml-auto flex items-center gap-1">
          <Button variant="ghost" size="icon-sm" aria-label={collapsed ? 'Expand' : 'Collapse'} title={collapsed ? 'Expand' : 'Collapse'} onClick={() => setCollapsed(c => !c)}>
            {collapsed ? <ChevronUp /> : <ChevronDown />}
          </Button>
          <Button variant="ghost" size="icon-sm" aria-label="Close the run panel" title="Close" onClick={onClose} disabled={running !== null}>
            <X />
          </Button>
        </div>
      </header>
      {!collapsed && record && !running && (
        <div className="min-h-0 flex-1 overflow-auto">
          {tab === 'logs' && <LogsTab record={record} onFocus={onFocus} />}
          {tab === 'metrics' && <MetricsTab record={record} onFocus={onFocus} />}
          {tab === 'data' && <DataTab key={show?.at} record={record} onFocus={onFocus} pinned={pinned} onPin={onPin} show={show ?? undefined} />}
        </div>
      )}
    </section>
  );
}

const LEVELS = ['debug', 'info', 'warning', 'error'] as const;
const LEVEL_COLOR: Record<string, string> = { debug: 'text-muted-foreground', info: 'text-sky-600 dark:text-sky-400', warning: 'text-amber-600 dark:text-amber-400', error: 'text-destructive' };

/** every log line of the run, by time; a click focuses its component */
function LogsTab({ record, onFocus }: { record: RunRecord; onFocus: (nodeId: string) => void }) {
  const [level, setLevel] = useState<string>('all');
  const [node, setNode] = useState<string>('all');
  const lines = useMemo(
    () =>
      record.components
        .flatMap(c => c.logs.map((line: LogLine) => ({ ...line, nodeId: c.nodeId, label: c.label })))
        .filter(l => (level === 'all' || LEVELS.indexOf(l.level as never) >= LEVELS.indexOf(level as never)) && (node === 'all' || l.nodeId === node))
        .sort((a, b) => a.at.localeCompare(b.at)),
    [record, level, node],
  );
  const select = 'h-7 rounded-md border bg-transparent px-2 text-xs';
  return (
    <div className="flex flex-col">
      <div className="sticky top-0 flex gap-2 border-b bg-card px-3 py-1.5">
        <select aria-label="Level" value={level} onChange={e => setLevel(e.target.value)} className={select}>
          <option value="all">All levels</option>
          {LEVELS.map(l => (
            <option key={l} value={l}>
              {l} and up
            </option>
          ))}
        </select>
        <select aria-label="Component" value={node} onChange={e => setNode(e.target.value)} className={select}>
          <option value="all">All components</option>
          {record.components.map(c => (
            <option key={c.nodeId} value={c.nodeId}>
              {c.label}
            </option>
          ))}
        </select>
      </div>
      {lines.length === 0 && <p className="p-3 text-xs text-muted-foreground">No log lines.</p>}
      <ul className="font-mono text-xs">
        {lines.map((l, i) => (
          <li key={i}>
            <button type="button" onClick={() => onFocus(l.nodeId)} className="flex w-full gap-3 px-3 py-0.5 text-left hover:bg-accent">
              <span className="shrink-0 text-muted-foreground">{time(l.at)}</span>
              <span className={cn('w-14 shrink-0', LEVEL_COLOR[l.level])}>{l.level}</span>
              <span className="w-40 shrink-0 truncate text-foreground">{l.label}</span>
              <span className="min-w-0 break-words whitespace-pre-wrap">{l.message}</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

const ports = (counts: Record<string, number>) =>
  Object.keys(counts).length > 1 ? Object.entries(counts).map(([p, n]) => `${p}: ${n}`).join(' · ') : String(total(counts));

/** one row per component: status, envelopes in and out per port, the times */
function MetricsTab({ record, onFocus }: { record: RunRecord; onFocus: (nodeId: string) => void }) {
  return (
    <table className="w-full text-xs">
      <thead className="sticky top-0 bg-card text-left text-muted-foreground">
        <tr className="border-b">
          {['Component', 'In', 'Out', 'Active', 'Waiting', 'Duration'].map(h => (
            <th key={h} className="px-3 py-1.5 font-medium">
              {h}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {record.components.map(c => (
          <tr key={c.nodeId} onClick={() => onFocus(c.nodeId)} className="cursor-pointer border-b hover:bg-accent">
            <td className="px-3 py-1.5">
              <span className="flex items-center gap-2">
                <StatusIcon status={c.status} />
                <span className="font-medium">{c.label}</span>
                <span className="text-muted-foreground">{componentInfo(c.type)?.label}</span>
              </span>
            </td>
            <td className="px-3 py-1.5 font-mono">{ports(c.inputs)}</td>
            <td className="px-3 py-1.5 font-mono">{ports(c.outputs)}</td>
            <td className="px-3 py-1.5 font-mono">{ms(c.activeTimeMs)}</td>
            <td className="px-3 py-1.5 font-mono">{ms(c.waitingMs)}</td>
            <td className="px-3 py-1.5 font-mono">{ms(c.durationMs)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** a component's input and output envelopes (the first ones), side by side, as a table or JSON; Pin output here */
function DataTab(props: {
  record: RunRecord;
  onFocus: (nodeId: string) => void;
  pinned: Set<string>;
  onPin: (nodeId: string, pinned: boolean) => void;
  show?: { nodeId: string; port: string };
}) {
  const { record, onFocus, pinned, onPin, show } = props;
  const shown = record.components.filter(c => c.type !== 'end' || total(c.inputs) > 0);
  const [selected, setSelected] = useState<string | undefined>(show?.nodeId ?? shown.find(c => c.type !== 'start')?.nodeId ?? shown[0]?.nodeId);
  // Table or JSON: the same for every component, kept in this browser tab
  const [view, setViewState] = useState<'table' | 'json'>(() => readChoice(VIEW_KEY, VIEWS, 'table'));
  const setView = (next: 'table' | 'json') => {
    setViewState(next);
    rememberChoice(VIEW_KEY, next);
  };
  const c = shown.find(x => x.nodeId === selected);
  return (
    <div className="flex h-full min-h-0">
      <ul aria-label="Components" className="w-52 shrink-0 overflow-auto border-r py-1 text-xs">
        {shown.map(x => (
          <li key={x.nodeId}>
            <button
              type="button"
              onClick={() => {
                setSelected(x.nodeId);
                onFocus(x.nodeId);
              }}
              className={cn('flex w-full items-center gap-2 px-3 py-1 text-left hover:bg-accent', x.nodeId === selected && 'bg-accent font-medium')}
            >
              <StatusIcon status={x.status} className="size-3.5" />
              <span className="truncate">{x.label}</span>
            </button>
          </li>
        ))}
      </ul>
      {c && (
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="flex items-center gap-2 border-b px-3 py-1.5">
            <div role="radiogroup" aria-label="View" className="flex gap-1">
              {VIEWS.map(v => (
                <button
                  key={v}
                  type="button"
                  role="radio"
                  aria-checked={view === v}
                  onClick={() => setView(v)}
                  className={cn('rounded-md px-2 py-0.5 text-xs uppercase', view === v ? 'bg-accent font-medium' : 'text-muted-foreground hover:text-foreground')}
                >
                  {v}
                </button>
              ))}
            </div>
            {c.type !== 'start' && c.type !== 'end' && runActions(c, pinned.has(c.nodeId)).pin && (
              <Button variant="outline" size="sm" className="ml-auto h-7 text-xs" onClick={() => onPin(c.nodeId, !pinned.has(c.nodeId))}>
                <Pin className={cn(pinned.has(c.nodeId) && 'rotate-45 text-blue-600 dark:text-blue-400')} /> {pinned.has(c.nodeId) ? 'Unpin output' : 'Pin output'}
              </Button>
            )}
          </div>
          <div className="grid min-h-0 flex-1 grid-cols-2 divide-x overflow-hidden">
            <Envelopes title={`Input (${total(c.inputs)})`} envelopes={c.inputSample} view={view} />
            <div className="flex min-h-0 flex-col overflow-auto">
              {Object.keys(c.outputSample).length === 0 && <Envelopes title="Output (0)" envelopes={[]} view={view} />}
              {Object.entries(c.outputSample).map(([port, envelopes]) => (
                <Envelopes
                  key={port}
                  title={`Output ${Object.keys(c.outputSample).length > 1 ? port + ' ' : ''}(${c.outputs[port] ?? envelopes.length})`}
                  envelopes={envelopes}
                  view={view}
                  inView={show?.nodeId === c.nodeId && show.port === port}
                />
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

const cell = (value: unknown): ReactNode => (value === null || value === undefined ? <span className="text-muted-foreground">null</span> : typeof value === 'object' ? JSON.stringify(value) : String(value));

function Envelopes({ title, envelopes, view, inView }: { title: string; envelopes: EnvelopeData[]; view: 'table' | 'json'; inView?: boolean }) {
  const columns = [...new Set(envelopes.flatMap(e => Object.keys(e)))];
  return (
    <section
      // the port whose count was clicked on the canvas: scrolled into view and marked
      ref={element => {
        if (inView) {
          element?.scrollIntoView({ block: 'nearest' });
        }
      }}
      data-shown={inView || undefined}
      className={cn('flex min-h-0 flex-col overflow-auto', inView && 'ring-1 ring-primary/40 ring-inset')}
    >
      <h4 className="sticky top-0 border-b bg-card px-3 py-1 text-[10px] font-medium tracking-wide text-muted-foreground uppercase">{title}</h4>
      {envelopes.length === 0 ? (
        <p className="p-3 text-xs text-muted-foreground">No envelopes.</p>
      ) : view === 'json' ? (
        <pre className="p-3 font-mono text-xs whitespace-pre-wrap">{JSON.stringify(envelopes, null, 2)}</pre>
      ) : (
        <table className="w-max min-w-full font-mono text-xs">
          <thead className="text-left text-muted-foreground">
            <tr className="border-b">
              {columns.map(col => (
                <th key={col} className="px-3 py-1 font-medium">
                  ${col}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {envelopes.map((e, i) => (
              <tr key={i} className="border-b align-top">
                {columns.map(col => (
                  <td key={col} className="max-w-80 truncate px-3 py-1" title={typeof e[col] === 'object' ? JSON.stringify(e[col]) : String(e[col] ?? '')}>
                    {cell(e[col])}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
